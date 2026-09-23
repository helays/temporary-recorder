import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { editorManager } from "../extensions/editorManager";
import { useStatusStore } from "../stores/statusStore";
import { normalizeNewlines } from "../utils/text";

/**
 * 自绘菜单的「剪切 / 复制 / 粘贴」。
 *
 * 原生菜单栏在时，这三项用的是 Tauri 的原生预定义项（由系统把命令转发给 WebView）；
 * 换成自绘菜单后那条路没了，改为走官方剪贴板插件 + CodeMirror 事务——
 * 不用 navigator.clipboard 是因为 WebView2 对 clipboard-read 的默认处理不可靠。
 *
 * 注意：Ctrl+X/C/V 本身仍由 WebView/CodeMirror 原生处理，不经过这里；
 * 这里只服务菜单项点击。
 */

function report(kind: "info" | "error", text: string): void {
  useStatusStore.getState().setMessage({ kind, text });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 复制当前选区 */
export async function copySelection(): Promise<void> {
  const text = editorManager.getSelectionText();
  if (text.length === 0) {
    report("info", "没有选中内容，未复制");
    return;
  }
  try {
    await writeText(text);
    report("info", `已复制 ${text.length} 个字符`);
  } catch (err) {
    report("error", `复制失败：${describeError(err)}`);
  }
}

/** 剪切当前选区 */
export async function cutSelection(): Promise<void> {
  const text = editorManager.getSelectionText();
  if (text.length === 0) {
    report("info", "没有选中内容，未剪切");
    return;
  }
  try {
    await writeText(text);
    editorManager.replaceSelection("");
    report("info", `已剪切 ${text.length} 个字符`);
  } catch (err) {
    // 写剪贴板失败时不动编辑器，避免内容既没进剪贴板又被删掉
    report("error", `剪切失败：${describeError(err)}`);
  }
}

/** 粘贴到光标处（覆盖当前选区）。换行统一归一为 LF，与文件读写保持一致 */
export async function pasteFromClipboard(): Promise<void> {
  let text: string;
  try {
    text = await readText();
  } catch (err) {
    report("error", `粘贴失败：${describeError(err)}`);
    return;
  }
  if (text.length === 0) {
    report("info", "剪贴板里没有文本");
    return;
  }
  const normalized = normalizeNewlines(text);
  editorManager.replaceSelection(normalized);
  report("info", `已粘贴 ${normalized.length} 个字符`);
}
