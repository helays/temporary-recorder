import { appLocalDataDir, basename, join } from "@tauri-apps/api/path";
import { ensureDir } from "./fileService";
import { useSettingsStore } from "../stores/settingsStore";

let cachedDefault: string | null = null;

/**
 * 默认临时目录：`%LOCALAPPDATA%\<identifier>\temp`。
 * 刻意不用系统 %TEMP%——那里会被系统清理工具或用户手动清空，草稿会丢。
 */
export async function defaultTempDir(): Promise<string> {
  if (cachedDefault === null) {
    cachedDefault = await join(await appLocalDataDir(), "temp");
  }
  return cachedDefault;
}

/** 当前生效的临时目录（设置里配置的优先），并确保它存在 */
export async function effectiveTempDir(): Promise<string> {
  const configured = useSettingsStore.getState().tempDir.trim();
  const dir = configured.length > 0 ? configured : await defaultTempDir();
  await ensureDir(dir);
  return dir;
}

/** Windows 文件名里不允许的字符 */
const ILLEGAL_IN_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 由标题生成临时文件名。
 * 用「可读标题 + id 前 8 位」：既能直接在资源管理器里认出是哪个草稿，
 * 又不会重名；标题改名不需要重命名文件（标题只是标签的 label）。
 */
export function tempFileName(title: string, id: string): string {
  const safe = title.replace(ILLEGAL_IN_NAME, "_").trim().slice(0, 40);
  const stem = safe.length > 0 ? safe : "未命名";
  return `${stem}-${id.slice(0, 8)}.txt`;
}

/** 临时文件的完整路径 */
export async function tempFilePath(title: string, id: string): Promise<string> {
  return join(await effectiveTempDir(), tempFileName(title, id));
}

/** 判断某个路径是否落在当前临时目录内（用于标记 is_temp） */
export async function isPathInTempDir(path: string): Promise<boolean> {
  const dir = await effectiveTempDir();
  return path.toLowerCase().startsWith(dir.toLowerCase());
}

/** 由文件路径推导标签标题：取文件名 */
export async function titleFromPath(path: string): Promise<string> {
  const name = await basename(path);
  return name.length > 0 ? name : path;
}
