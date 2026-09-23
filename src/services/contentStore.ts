import { useSettingsStore } from "../stores/settingsStore";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import { pathStatus, writeTextFile } from "./fileService";
import { updateTabDiskMtime } from "./tabsRepo";

export type SaveOutcome =
  | "written"
  | "no-file"
  | "disabled"
  | "conflict"
  | "error";

/**
 * 把标签内容写到它背后的那个文件——这是内容唯一的落盘路径（不再写数据库）。
 *
 * · 临时文件是我们自己建的，总是写。
 * · 真实文件受「打开的文件自动保存」开关约束，并且写之前先比对 mtime：
 *   若被别的程序改过就不覆盖，改为提示，避免悄悄吃掉别人的修改。
 */
export async function saveTabContent(tabId: string, content: string): Promise<SaveOutcome> {
  const store = useTabsStore.getState();
  const tab = store.tabs.find((item) => item.id === tabId);
  if (tab === undefined || tab.file_path === null) return "no-file";

  const isTemp = tab.is_temp === 1;
  if (!isTemp && !useSettingsStore.getState().autoSaveToFile) return "disabled";

  try {
    if (!isTemp && tab.disk_mtime !== null && tab.disk_mtime > 0) {
      const status = await pathStatus(tab.file_path);
      if (status.exists && status.mtime_ms !== tab.disk_mtime) {
        // 只在首次发现冲突时提示，否则每敲一个字都会刷屏
        if (!store.isConflicted(tabId)) {
          store.markConflict(tabId);
          useStatusStore.getState().setMessage({
            kind: "error",
            text: `文件已被其他程序修改，已暂停自动保存（Ctrl+S 可强制覆盖）：${tab.file_path}`,
          });
        }
        return "conflict";
      }
    }

    const mtime = await writeTextFile(tab.file_path, content);
    store.setDiskMtime(tabId, mtime);
    void updateTabDiskMtime(tabId, mtime);
    return "written";
  } catch (err) {
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `写入文件失败：${err instanceof Error ? err.message : String(err)}`,
    });
    return "error";
  }
}

/**
 * 显式保存（Ctrl+S）：无视自动保存开关与冲突标记，强制写盘。
 * 用于「用户明确要求保存」的场景。
 */
export async function forceSaveTabContent(
  tabId: string,
  content: string,
): Promise<SaveOutcome> {
  useTabsStore.getState().clearConflict(tabId);
  const store = useTabsStore.getState();
  const tab = store.tabs.find((item) => item.id === tabId);
  if (tab === undefined || tab.file_path === null) return "no-file";

  try {
    const mtime = await writeTextFile(tab.file_path, content);
    store.setDiskMtime(tabId, mtime);
    void updateTabDiskMtime(tabId, mtime);
    return "written";
  } catch (err) {
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `保存失败：${err instanceof Error ? err.message : String(err)}`,
    });
    return "error";
  }
}
