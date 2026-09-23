//! 文本文件读写桥接。
//!
//! 为什么不用 `tauri-plugin-fs`：它的 scope 不跨重启（选中路径只在本次运行内有效），
//! 而本应用需要在重启后恢复文件标签、并读取用户自定义的临时目录。
//! 要走 plugin-fs 就得开 `**` 全域 scope，等于把整个文件系统交给前端；
//! 这里只做纯 I/O 桥接、不含业务逻辑，权限面反而更小。
//!
//! 约定（与 AGENTS.md 一致）：一律 UTF-8 无 BOM、LF 换行。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Serialize)]
pub struct TextFilePayload {
    /// 已归一为 LF 的内容
    content: String,
    /// 文件修改时间（Unix 毫秒），用于外部改动检测
    mtime_ms: i64,
    size: u64,
}

#[derive(Serialize)]
pub struct PathStatus {
    exists: bool,
    is_dir: bool,
    mtime_ms: i64,
    size: u64,
}

#[derive(Serialize)]
pub struct DirEntryInfo {
    name: String,
    path: String,
    is_file: bool,
    size: u64,
    mtime_ms: i64,
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// CRLF / CR 统一成 LF
fn normalize_newlines(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// 读取文本文件。非 UTF-8 会明确报错，而不是悄悄产生乱码。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFilePayload, String> {
    let target = PathBuf::from(&path);
    let bytes = fs::read(&target).map_err(|e| format!("读取失败：{e}"))?;
    // 去掉 UTF-8 BOM
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let text =
        String::from_utf8(body.to_vec()).map_err(|_| "文件不是 UTF-8 编码，暂不支持".to_string())?;
    let meta = fs::metadata(&target).map_err(|e| format!("读取文件信息失败：{e}"))?;

    Ok(TextFilePayload {
        content: normalize_newlines(&text),
        mtime_ms: mtime_ms(&meta),
        size: meta.len(),
    })
}

/// 写入文本文件，返回写入后的 mtime。
///
/// 采用「先写同目录临时文件、再改名覆盖」的原子替换：
/// 写到一半失败也不会把原文件截断。Windows 上 fs::rename 会替换已存在的目标，
/// 因此目标被别的程序占用时会失败——此时原文件保持完好，由调用方报错即可。
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<i64, String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("untitled");
    let tmp = target.with_file_name(format!(".{}.{}.tmp", file_name, std::process::id()));

    let normalized = normalize_newlines(&content);
    {
        let mut file = fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败：{e}"))?;
        file.write_all(normalized.as_bytes())
            .map_err(|e| format!("写入失败：{e}"))?;
        file.sync_all().map_err(|e| format!("落盘失败：{e}"))?;
    }

    if let Err(err) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换目标文件失败（可能被其他程序占用）：{err}"));
    }

    let meta = fs::metadata(&target).map_err(|e| format!("读取文件信息失败：{e}"))?;
    Ok(mtime_ms(&meta))
}

/// 查询路径状态。文件不存在是正常状态，不作为错误返回。
#[tauri::command]
pub fn path_status(path: String) -> Result<PathStatus, String> {
    match fs::metadata(Path::new(&path)) {
        Ok(meta) => Ok(PathStatus {
            exists: true,
            is_dir: meta.is_dir(),
            mtime_ms: mtime_ms(&meta),
            size: meta.len(),
        }),
        Err(_) => Ok(PathStatus {
            exists: false,
            is_dir: false,
            mtime_ms: 0,
            size: 0,
        }),
    }
}

/// 删除文件；文件本就不存在时返回 false。
#[tauri::command]
pub fn delete_file(path: String) -> Result<bool, String> {
    match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!("删除失败：{err}")),
    }
}

/// 列出目录内容；目录不存在时返回空列表。
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("读取目录失败：{err}")),
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        out.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry_path.to_string_lossy().to_string(),
            is_file: meta.is_file(),
            size: meta.len(),
            mtime_ms: mtime_ms(&meta),
        });
    }
    Ok(out)
}

/// 确保目录存在（含中间层级）
#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("创建目录失败：{e}"))
}
