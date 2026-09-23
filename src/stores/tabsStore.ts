import { create } from "zustand";
import type { TabMeta, TabRecord } from "../types/models";
import { newId } from "../utils/id";
import {
  deleteTab,
  insertTab,
  nextSortOrder,
  updateTabOrder,
  updateTabTitle,
} from "../services/tabsRepo";
import { writeActiveTab } from "../services/sessionRepo";
import { editorManager } from "../extensions/editorManager";

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
  /** 会话恢复完成后写入初始数据 */
  setInitial: (tabs: TabMeta[], activeTabId: string | null) => void;
  createTab: () => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  renameTab: (id: string, title: string) => Promise<void>;
  activateTab: (id: string) => Promise<void>;
  /** 按给定顺序重排（拖拽排序用），并立即落库 */
  applyOrder: (orderedIds: string[]) => Promise<void>;
  /** 相对切换，delta 为 +1 / -1 */
  cycleTab: (delta: number) => Promise<void>;
  activateIndex: (index: number) => Promise<void>;
}

/**
 * 标签元数据 + 激活标签。编辑器内容不在这里（由 CodeMirror 管理）。
 * 所有会改变结构的操作都立即写库；内容写入由 editorManager 防抖驱动。
 */
export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  setInitial: (tabs, activeTabId) => set({ tabs, activeTabId }),

  createTab: async () => {
    const id = newId();
    const now = Date.now();
    const sortOrder = await nextSortOrder();
    const title = nextUntitledTitle(get().tabs);
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
    };

    const stored = await insertTab(record);
    if (!stored) return;

    // 内容必然为空，直接建立编辑器状态，省掉一次数据库往返
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

    // 先落库再丢状态，保证未保存的输入不丢
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
}));
