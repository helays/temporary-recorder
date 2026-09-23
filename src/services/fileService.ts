import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/** 读取结果：内容是已归一为 LF 的 UTF-8 文本 */
export interface TextFilePayload {
  content: string;
  mtime_ms: number;
  size: number;
}

export interface PathStatus {
  exists: boolean;
  is_dir: boolean;
  mtime_ms: number;
  size: number;
}

export interface DirEntryInfo {
  name: string;
  path: string;
  is_file: boolean;
  size: number;
  mtime_ms: number;
}

/**
 * 以下命令都是本应用自己注册的（src-tauri/src/commands/textfile.rs）。
 * Tauri 的 ACL 只约束插件命令，应用自身的 command 不需要在 capability 里声明。
 */
export function readTextFile(path: string): Promise<TextFilePayload> {
  return invoke<TextFilePayload>("read_text_file", { path });
}

/** 返回写入后的 mtime */
export function writeTextFile(path: string, content: string): Promise<number> {
  return invoke<number>("write_text_file", { path, content });
}

export function pathStatus(path: string): Promise<PathStatus> {
  return invoke<PathStatus>("path_status", { path });
}

export function deleteFile(path: string): Promise<boolean> {
  return invoke<boolean>("delete_file", { path });
}

export function listDir(path: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>("list_dir", { path });
}

export function ensureDir(path: string): Promise<void> {
  return invoke<void>("ensure_dir", { path });
}

/** 在资源管理器中打开该路径 */
export function revealPath(path: string): Promise<void> {
  return invoke<void>("reveal_path", { path });
}

/** 打开/另存为对话框的过滤器 */
const TEXT_FILTERS = [
  { name: "JSON", extensions: ["json"] },
  { name: "YAML", extensions: ["yaml", "yml"] },
  { name: "文本", extensions: ["txt", "md", "log"] },
  { name: "所有文件", extensions: ["*"] },
];

/** 弹出「打开文件」。取消时返回 null。 */
export async function pickOpenFile(): Promise<string | null> {
  const selected = await open({
    title: "打开文件",
    multiple: false,
    directory: false,
    filters: TEXT_FILTERS,
  });
  return typeof selected === "string" ? selected : null;
}

/** 弹出「另存为」。取消时返回 null。 */
export async function pickSaveFile(defaultPath?: string): Promise<string | null> {
  return save({
    title: "另存为",
    defaultPath,
    filters: TEXT_FILTERS,
  });
}

/** 弹出目录选择（用于设置临时目录）。取消时返回 null。 */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const selected = await open({
    title: "选择目录",
    directory: true,
    multiple: false,
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}
