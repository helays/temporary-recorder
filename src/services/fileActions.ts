import { editorManager } from "../extensions/editorManager";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import { forceSaveTabContent } from "./contentStore";
import {
  deleteFile,
  pickOpenFile,
  pickSaveFile,
  readTextFile,
  writeTextFile,
  type TextFilePayload,
} from "./fileService";
import { titleFromPath } from "./tempFiles";

/** 超过此大小拒绝打开：整文件读进内存会卡死（5MB 以上本来就会关掉语法高亮） */
const MAX_OPEN_SIZE = 20 * 1024 * 1024;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 打开文件到新标签。
 * 若该文件已经在某个标签里打开，直接切过去，不重复打开。
 */
export async function openFileIntoNewTab(): Promise<void> {
  const path = await pickOpenFile();
  if (path === null) return;

  const store = useTabsStore.getState();
  const existing = store.tabs.find(
    (tab) => tab.file_path !== null && tab.file_path.toLowerCase() === path.toLowerCase(),
  );
  if (existing !== undefined) {
    await store.activateTab(existing.id);
    useStatusStore.getState().setMessage({ kind: "info", text: `该文件已打开：${path}` });
    return;
  }

  let payload: TextFilePayload;
  try {
    payload = await readTextFile(path);
  } catch (err) {
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `打开失败（${path}）：${describeError(err)}`,
    });
    return;
  }

  if (payload.size > MAX_OPEN_SIZE) {
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `文件过大（${Math.round(payload.size / 1024 / 1024)} MB），暂不支持打开`,
    });
    return;
  }

  const title = await titleFromPath(path);
  await useTabsStore.getState().addFileTab(path, title, payload.content, payload.mtime_ms);
}

/**
 * 保存当前标签。
 * 临时标签还没落到真实文件上，所以走「另存为」；真实文件直接强制写盘。
 */
export async function saveActiveTab(): Promise<void> {
  const store = useTabsStore.getState();
  const tabId = store.activeTabId;
  if (tabId === null) return;
  const tab = store.tabs.find((item) => item.id === tabId);
  if (tab === undefined) return;

  if (tab.is_temp === 1 || tab.file_path === null) {
    await saveActiveTabAs();
    return;
  }

  const content = editorManager.getActiveContent() ?? "";
  const outcome = await forceSaveTabContent(tabId, content);
  if (outcome === "written") {
    useStatusStore.getState().setMessage({ kind: "info", text: `已保存：${tab.file_path}` });
  }
}

/**
 * 另存为：写到用户选定的路径，把标签重新绑定到该文件，
 * 并按约定删除原来的临时文件（临时文件只在「还没另存为」的阶段有用）。
 */
export async function saveActiveTabAs(): Promise<void> {
  const store = useTabsStore.getState();
  const tabId = store.activeTabId;
  if (tabId === null) return;
  const tab = store.tabs.find((item) => item.id === tabId);
  if (tab === undefined) return;

  const content = editorManager.getActiveContent() ?? "";
  const defaultPath = tab.is_temp === 1 ? undefined : (tab.file_path ?? undefined);
  const target = await pickSaveFile(defaultPath);
  if (target === null) return;

  const previousPath = tab.file_path;
  const wasTemp = tab.is_temp === 1;

  try {
    const mtime = await writeTextFile(target, content);
    const title = await titleFromPath(target);
    await store.bindTabFile(tabId, target, false, mtime);
    await store.renameTab(tabId, title);

    if (wasTemp && previousPath !== null && previousPath !== target) {
      try {
        await deleteFile(previousPath);
      } catch (err) {
        // 删不掉不算失败：文件已写到新位置，旧临时文件留待手动清理
        console.error("[file] 删除旧临时文件失败:", previousPath, err);
      }
    }

    useStatusStore.getState().setMessage({ kind: "info", text: `已另存为：${target}` });
  } catch (err) {
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `另存为失败（${target}）：${describeError(err)}`,
    });
  }
}
