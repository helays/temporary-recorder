//! 命令行入口：把「双击文件 / 打开方式 / 拖到 exe 上」交过来的路径转成待打开队列。
//!
//! 为什么需要这一层：Windows 注册文件关联时写下的打开命令是
//! `"<exe>" "%1"`（安装包的 ProgID 与「打开方式 → 选择其他应用 → 浏览到 exe」
//! 两种注册方式都是这个形状），被双击的文件就是**第 1 个命令行参数**。
//! 参数只是躺在 `std::env::args()` 里，不读它，应用就表现成「设了默认程序却没反应」。
//!
//! 队列与事件的分工：
//! · 队列（[`PendingOpenPaths`]）是**唯一真源**，只有 [`take_pending_open_paths`] 能取走；
//! · `open-paths` 事件只是「队列里有东西了」的唤醒信号。
//!
//! 这样两种时序都不会出问题：事件早于前端订阅（被丢掉，但路径还在队列里，
//! 前端启动时会取一次）、事件晚于前端取队列（路径在队列里，取走时拿到的是全部）。
//! 前端因此不需要去重逻辑。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// 唤醒前端的自定义事件名（与 src/services/openRequests.ts 保持一致）
const OPEN_EVENT: &str = "open-paths";

/// 待打开的文件路径队列。
///
/// 用托管状态（而不是直接把路径 emit 给前端）：首启时前端还没订阅，
/// emit 出去的事件没人接；队列则一直等到前端来取。
#[derive(Default)]
pub struct PendingOpenPaths(Mutex<Vec<String>>);

/// 从命令行参数里挑出「像文件路径」的部分。
///
/// · 跳过 `argv[0]`（exe 自身）；
/// · 跳过以 `-` 开头的开关；
/// · 去掉可能残留的成对引号（cmd 转发时偶见）；
/// · 相对路径按 `cwd` 解析成绝对路径（`join` 对 `\foo` 这类「带根」路径也正确）；
/// · 只保留真实存在的路径——不存在的参数多半不是文件（各种运行时开关、
///   已经失效的关联目标），留给前端只会变成状态栏噪音。
pub fn candidate_paths(argv: &[String], cwd: &str) -> Vec<String> {
    argv.iter()
        .skip(1)
        .map(|arg| arg.trim_matches('"'))
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .map(|arg| resolve(arg, cwd))
        .filter(|path| Path::new(path).exists())
        .collect()
}

/// 相对路径按 cwd 补全；已是绝对路径的原样返回
fn resolve(arg: &str, cwd: &str) -> String {
    let path = Path::new(arg);
    if path.is_absolute() {
        return arg.to_string();
    }
    PathBuf::from(cwd).join(path).to_string_lossy().into_owned()
}

/// 把一批命令行参数放进队列，并唤醒前端。
///
/// 不带文件参数时（例如只是又点了一次桌面快捷方式）也会被调用：
/// 那种情况下唯一有意义的动作就是把已有的窗口调到前台。
pub fn enqueue(app: &AppHandle, argv: &[String], cwd: &str) {
    focus_main_window(app);

    let paths = candidate_paths(argv, cwd);
    if paths.is_empty() {
        return;
    }

    let Some(state) = app.try_state::<PendingOpenPaths>() else {
        eprintln!("[launch] 待打开队列未注册，忽略 {} 个命令行路径", paths.len());
        return;
    };
    match state.0.lock() {
        Ok(mut queue) => queue.extend(paths),
        // 中毒（某次持锁时 panic）不该连带把用户的文件丢掉：取回内部数据继续用
        Err(poisoned) => poisoned.into_inner().extend(paths),
    }

    if let Err(err) = app.emit(OPEN_EVENT, ()) {
        eprintln!("[launch] 唤醒前端失败：{err}");
    }
}

/// 拾取本进程启动时的命令行参数（首个实例走这条路；
/// 已在运行的那个实例由单实例插件的回调转交，见 lib.rs）。
pub fn enqueue_from_env(app: &AppHandle) {
    let argv: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let cwd = std::env::current_dir()
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_default();
    enqueue(app, &argv, &cwd);
}

/// 让既有窗口回到前台。
///
/// 首启时窗口还没 `show()`（配置里 `visible: false`），这时**不能**抢焦点：
/// 抢了会把一个尚未完成首帧绘制的窗口以白屏形式弹出来，
/// 启动流程本来就会在绘制完成后自己 show（见 App.tsx 的 showWindowWhenPainted）。
fn focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// 取走待打开队列。取一次少一次，前端每次被唤醒都调它。
#[tauri::command]
pub fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut queue) => std::mem::take(&mut *queue),
        Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
    }
}

/// 打开 Windows 的「默认应用」设置页。
///
/// Windows 10/11 用带校验的 `UserChoice` 保护用户自己选过的默认程序，
/// 安装包只能把闪记写进候选列表，最后一步必须由用户在系统里确认。
/// 与其让用户自己去翻设置，不如直接把他送过去（菜单：帮助 ▸ 设为默认打开方式…）。
#[tauri::command]
pub fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        // 空标题参数不能省：`start` 会把第一个参数当成新窗口的标题
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开系统设置失败：{e}"))
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 参数筛选是纯函数里最容易写错的部分（argv[0]、开关、引号、相对路径），
    /// 这里用真实临时文件验一遍，不依赖应用运行时。
    #[test]
    fn picks_existing_file_arguments_only() {
        let dir = std::env::temp_dir();
        let name = format!("shanshan-launch-args-{}.json", std::process::id());
        let file = dir.join(&name);
        std::fs::write(&file, "{}").expect("写入临时文件");

        let absolute = file.to_string_lossy().into_owned();
        let cwd = dir.to_string_lossy().into_owned();

        // argv[0] 与开关被跳过，不存在的路径被过滤
        let argv = vec![
            "temporary-recorder.exe".to_string(),
            absolute.clone(),
            format!("{name}.missing"),
            "--flag".to_string(),
        ];
        assert_eq!(candidate_paths(&argv, &cwd), vec![absolute.clone()]);

        // 相对路径按 cwd 解析
        let argv = vec!["temporary-recorder.exe".to_string(), name.clone()];
        assert_eq!(candidate_paths(&argv, &cwd), vec![absolute.clone()]);

        // 残留引号被去掉
        let argv = vec!["temporary-recorder.exe".to_string(), format!("\"{absolute}\"")];
        assert_eq!(candidate_paths(&argv, &cwd), vec![absolute.clone()]);

        // 只带 exe 自己时没有任何待打开文件
        let argv = vec!["temporary-recorder.exe".to_string()];
        assert!(candidate_paths(&argv, &cwd).is_empty());

        let _ = std::fs::remove_file(&file);
    }
}
