import { create } from "zustand";
import type { TabMeta, TabRecord } from "../types/models";
import { newId } from "../utils/id";
import {
  deleteTab,
  insertTab,
  nextSortOrder,
  updateTabFile,
  updateTabOrder,
  updateTabTitle,
} from "../services/tabsRepo";
import { writeActiveTab } from "../services/sessionRepo";
import { tempFilePath } from "../services/tempFiles";
import { writeTextFile } from "../services/fileService";
import { languageIdFromPath } from "../services/languages";
import { editorManager } from "../extensions/editorManager";
import { useStatusStore } from "./statusStore";

const UNTITLED_PREFIX = "未命名";

function toMeta(tab: TabRecord): TabMeta {
  return {
    id: tab.id,
    title: tab.title,
    sort_order: tab.sort_order,
    cursor_line: tab.cursor_line,
    cursor_ch: tab.cursor_ch,
    scroll_top: tab.scroll_top,
    created_at: tab.created_at,
    updated_at: tab.updated_at,
    file_path: tab.file_path,
    is_temp: tab.is_temp,
    disk_mtime: tab.disk_mtime,
  };
}

function nextUntitledTitle(tabs: TabMeta[]): string {
  const used = new Set(tabs.map((tab) => tab.title));
  let index = tabs.length + 1;
  while (used.has(`${UNTITLED_PREFIX} ${index}`)) index += 1;
  return `${UNTITLED_PREFIX} ${index}`;
}

interface TabsState {
  tabs: TabMeta[];
  activeTabId: string | null;
  /** 检测到外部改动、已暂停自动保存的标签 */
  conflicts: Record<string, true>;

  setInitial: (tabs: TabMeta[], activeTabId: string | null) => void;
  createTab: () => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  renameTab: (id: string, title: string) => Promise<void>;
  activateTab: (id: string) => Promise<void>;
  applyOrder: (orderedIds: string[]) => Promise<void>;
  cycleTab: (delta: number) => Promise<void>;
  activateIndex: (index: number) => Promise<void>;

  /** 把标签绑定到新的文件（新建、另存为、打开文件都用它） */
  bindTabFile: (id: string, filePath: string | null, isTemp: boolean, diskMtime: number | null) => Promise<void>;
  /** 打开一个新的文件标签（内容已由调用方读好） */
  addFileTab: (filePath: string, title: string, content: string, diskMtime: number) => Promise<void>;
  /** 记录文件最新的 mtime（写文件后） */
  setDiskMtime: (id: string, diskMtime: number) => void;
  markConflict: (id: string) => void;
  clearConflict: (id: string) => void;
  isConflicted: (id: string) => boolean;
}

/**
 * 标签元数据 + 激活标签。
 * 编辑器内容不在这里（由 CodeMirror 管理，落盘到各自的文件）。
 * 所有会改变结构的操作都立即写库；内容写入由 editorManager 防抖驱动。
 */
export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  conflicts: {},

  setInitial: (tabs, activeTabId) => set({ tabs, activeTabId, conflicts: {} }),

  createTab: async () => {
    const id = newId();
    const now = Date.now();
    const sortOrder = await nextSortOrder();
    const title = nextUntitledTitle(get().tabs);

    // 新标签立刻在临时目录里落一个文件：内容以文件为准。
    // 临时目录不可用时退回「内容存库」，保证仍然能记事（迁移逻辑会把 file_path 为空的
    // 标签当作数据库内容读取）。
    let filePath: string | null = null;
    let diskMtime: number | null = null;
    try {
      filePath = await tempFilePath(title, id);
      diskMtime = await writeTextFile(filePath, "");
    } catch (err) {
      console.error("[tabs] 创建临时文件失败，退回数据库存储:", err);
      useStatusStore.getState().setMessage({
        kind: "error",
        text: `临时目录不可用，该标签暂存在数据库中：${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const record: TabRecord = {
      id,
      title,
      content: "",
      sort_order: sortOrder,
      cursor_line: 0,
      cursor_ch: 0,
      scroll_top: 0,
      created_at: now,
      updated_at: now,
      file_path: filePath,
      is_temp: 1,
      disk_mtime: diskMtime,
    };

    const stored = await insertTab(record);
    if (!stored) return;

    // 内容必然为空，直接建立编辑器状态，省掉一次读盘
    editorManager.preload(id, {
      content: "",
      cursorLine: 0,
      cursorCh: 0,
      scrollTop: 0,
    });

    set((state) => ({ tabs: [...state.tabs, toMeta(record)], activeTabId: id }));
    await writeActiveTab(id);
  },

  closeTab: async (id) => {
    const { tabs, activeTabId } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    // 注意：这里刻意【不删除】临时文件。
    // 关闭临时标签后，它的内容仍留在临时目录里可以找回；
    // 清理交给「设置」里的手动操作，只清理没有任何标签引用的孤儿文件。
    editorManager.disposeTab(id);
    await deleteTab(id);

    const remaining = tabs.filter((tab) => tab.id !== id);
    if (remaining.length === 0) {
      // 关掉最后一个标签时补一个空白标签，避免界面进入无标签状态
      set({ tabs: [], activeTabId: null });
      await get().createTab();
      return;
    }

    // 关闭当前标签后，激活原位置上的下一个（末位则取前一个）
    const nextActiveId =
      activeTabId === id
        ? remaining[Math.min(index, remaining.length - 1)].id
        : activeTabId;

    set({ tabs: remaining, activeTabId: nextActiveId });
    if (nextActiveId !== activeTabId) await writeActiveTab(nextActiveId);
  },

  renameTab: async (id, title) => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    const now = Date.now();
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, title: trimmed, updated_at: now } : tab,
      ),
    }));
    await updateTabTitle(id, trimmed, now);
  },

  activateTab: async (id) => {
    if (get().activeTabId === id) return;
    set({ activeTabId: id });
    await writeActiveTab(id);
  },

  applyOrder: async (orderedIds) => {
    const byId = new Map(get().tabs.map((tab) => [tab.id, tab]));
    const ordered: TabMeta[] = [];
    for (const id of orderedIds) {
      const tab = byId.get(id);
      if (tab !== undefined && !ordered.some((item) => item.id === id)) {
        ordered.push({ ...tab, sort_order: ordered.length });
      }
    }
    // 防御：未出现在入参里的标签追加到末尾，避免漏写 sort_order
    for (const tab of get().tabs) {
      if (!ordered.some((item) => item.id === tab.id)) {
        ordered.push({ ...tab, sort_order: ordered.length });
      }
    }
    set({ tabs: ordered });
    await updateTabOrder(ordered.map((tab) => tab.id));
  },

  cycleTab: async (delta) => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 0) return;
    const current = tabs.findIndex((tab) => tab.id === activeTabId);
    const base = current < 0 ? 0 : current;
    const next = (base + delta + tabs.length) % tabs.length;
    await get().activateTab(tabs[next].id);
  },

  activateIndex: async (index) => {
    const tab = get().tabs[index];
    if (tab !== undefined) await get().activateTab(tab.id);
  },

  bindTabFile: async (id, filePath, isTemp, diskMtime) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, file_path: filePath, is_temp: isTemp ? 1 : 0, disk_mtime: diskMtime }
          : tab,
      ),
      conflicts: Object.fromEntries(
        Object.entries(state.conflicts).filter(([key]) => key !== id),
      ),
    }));
    await updateTabFile(id, filePath, isTemp ? 1 : 0, diskMtime);
  },

  addFileTab: async (filePath, title, content, diskMtime) => {
    const id = newId();
    const now = Date.now();
    const sortOrder = await nextSortOrder();
    const record: TabRecord = {
      id,
      title,
      content: "",
      sort_order: sortOrder,
      cursor_line: 0,
      cursor_ch: 0,
      scroll_top: 0,
      created_at: now,
      updated_at: now,
      file_path: filePath,
      is_temp: 0,
      disk_mtime: diskMtime,
    };

    if (!(await insertTab(record))) return;

    // 内容已经读好了，直接建立编辑器状态，避免再读一次盘
    editorManager.preload(id, {
      content,
      cursorLine: 0,
      cursorCh: 0,
      scrollTop: 0,
      languageId: languageIdFromPath(filePath) ?? undefined,
    });
    set((state) => ({ tabs: [...state.tabs, toMeta(record)], activeTabId: id }));
    await writeActiveTab(id);
  },

  setDiskMtime: (id, diskMtime) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, disk_mtime: diskMtime } : tab)),
    })),

  markConflict: (id) => set((state) => ({ conflicts: { ...state.conflicts, [id]: true } })),

  clearConflict: (id) =>
    set((state) => ({
      conflicts: Object.fromEntries(
        Object.entries(state.conflicts).filter(([key]) => key !== id),
      ),
    })),

  isConflicted: (id) => get().conflicts[id] === true,
}));
