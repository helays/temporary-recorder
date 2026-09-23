import { appDataDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { editorManager } from "../extensions/editorManager";
import { useSettingsStore } from "../stores/settingsStore";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import type { ThemePref } from "../types/models";
import { copySelection, cutSelection, pasteFromClipboard } from "./clipboard";
import { openFileIntoNewTab, saveActiveTab, saveActiveTabAs } from "./fileActions";
import { revealPath } from "./fileService";
import { formatActiveTab, minifyActiveTab } from "./formatActions";
import { cleanOrphanTempFiles, describeCleanup } from "./tempCleanup";
import { effectiveTempDir } from "./tempFiles";

/**
 * 顶部菜单的结构定义。
 *
 * 这里只产出数据，具体渲染在 components/TitleBar 里。
 * 之所以不用 Windows 原生菜单栏：原生菜单栏是系统画在标题栏下沿的一条独立横条，
 * 无法与「图标」「最小化/最大化/关闭」共处一行，而 VS Code 那种单行标题栏要求三者同行。
 */

export type MenuNode =
  | { kind: "separator" }
  | {
      kind: "item";
      id: string;
      label: string;
      /** 仅用于显示（如 Ctrl+N）；真正的按键处理在 keymap 与 shortcuts.ts */
      accelerator?: string;
      disabled?: boolean;
      run: () => void | Promise<void>;
    }
  | { kind: "check"; id: string; label: string; checked: boolean; run: () => void }
  | { kind: "submenu"; id: string; label: string; items: MenuNode[] };

export interface MenuSection {
  id: string;
  label: string;
  items: MenuNode[];
}

function report(kind: "info" | "error", text: string): void {
  useStatusStore.getState().setMessage({ kind, text });
}

/**
 * 执行一个菜单动作。
 * 统一在这里兜底：异步失败也要落到状态栏，不能变成 unhandled rejection。
 */
export function runMenuAction(run: () => void | Promise<void>): void {
  void Promise.resolve()
    .then(run)
    .catch((err: unknown) => {
      console.error("[menu] 菜单动作失败:", err);
      report("error", `操作失败：${err instanceof Error ? err.message : String(err)}`);
    });
}

/** 退出：走窗口 close()，让 onCloseRequested 里的强制落盘照常执行 */
function quitApp(): Promise<void> {
  return getCurrentWindow().close();
}

function closeActiveTab(): Promise<void> {
  const id = useTabsStore.getState().activeTabId;
  return id === null ? Promise.resolve() : useTabsStore.getState().closeTab(id);
}

function openTempDir(): Promise<void> {
  return effectiveTempDir().then((dir) => revealPath(dir));
}

function openDataDir(): Promise<void> {
  return appDataDir().then((dir) => revealPath(dir));
}

/** 「清理未使用的临时文件」：确认框与删除都在 tempCleanup 里，设置面板共用同一条路径 */
async function cleanTempFiles(): Promise<void> {
  const result = await cleanOrphanTempFiles();
  if (result.cancelled) return; // 取消是用户的正常选择，不必再写状态栏
  report("info", describeCleanup(result));
}

const THEME_CHOICES: Array<{ pref: ThemePref; label: string }> = [
  { pref: "system", label: "跟随系统" },
  { pref: "light", label: "浅色" },
  { pref: "dark", label: "深色" },
];

function themeSubmenu(themePref: ThemePref): MenuNode {
  return {
    kind: "submenu",
    id: "theme",
    label: "主题",
    items: THEME_CHOICES.map((choice) => ({
      kind: "check" as const,
      id: `theme-${choice.pref}`,
      label: choice.label,
      checked: themePref === choice.pref,
      run: () => useSettingsStore.getState().setThemePref(choice.pref),
    })),
  };
}

/**
 * 构建菜单结构。
 * 主题的勾选态来自调用方传入的 themePref，所以组件在主题变化时重建即可，
 * 不再需要像原生菜单那样维护 CheckMenuItem 句柄并手动同步。
 */
export function buildMenuSections(themePref: ThemePref): MenuSection[] {
  return [
    {
      id: "file",
      label: "文件",
      items: [
        {
          kind: "item",
          id: "new-tab",
          label: "新建标签",
          accelerator: "Ctrl+N",
          run: () => useTabsStore.getState().createTab(),
        },
        {
          kind: "item",
          id: "open-file",
          label: "打开…",
          accelerator: "Ctrl+O",
          run: openFileIntoNewTab,
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "save",
          label: "保存",
          accelerator: "Ctrl+S",
          run: saveActiveTab,
        },
        {
          kind: "item",
          id: "save-as",
          label: "另存为…",
          accelerator: "Ctrl+Shift+S",
          run: saveActiveTabAs,
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "close-tab",
          label: "关闭当前标签",
          accelerator: "Ctrl+W",
          run: closeActiveTab,
        },
        { kind: "separator" },
        { kind: "item", id: "quit", label: "退出", run: quitApp },
      ],
    },
    {
      id: "settings",
      label: "设置",
      items: [
        {
          kind: "item",
          id: "open-settings",
          label: "打开设置…",
          accelerator: "Ctrl+,",
          run: () => useStatusStore.getState().setSettingsOpen(true),
        },
        { kind: "separator" },
        { kind: "item", id: "open-temp-dir", label: "在资源管理器中打开临时目录", run: openTempDir },
        { kind: "item", id: "clean-temp", label: "清理未使用的临时文件", run: cleanTempFiles },
      ],
    },
    {
      id: "edit",
      label: "编辑",
      items: [
        // 撤销/重做/全选走 CodeMirror 自己的命令：原生 Undo 不认它的历史栈
        {
          kind: "item",
          id: "undo",
          label: "撤销",
          accelerator: "Ctrl+Z",
          run: () => {
            editorManager.undo();
          },
        },
        {
          kind: "item",
          id: "redo",
          label: "重做",
          accelerator: "Ctrl+Shift+Z",
          run: () => {
            editorManager.redo();
          },
        },
        { kind: "separator" },
        { kind: "item", id: "cut", label: "剪切", run: cutSelection },
        { kind: "item", id: "copy", label: "复制", run: copySelection },
        { kind: "item", id: "paste", label: "粘贴", run: pasteFromClipboard },
        {
          kind: "item",
          id: "select-all",
          label: "全选",
          accelerator: "Ctrl+A",
          run: () => {
            editorManager.selectAll();
          },
        },
        { kind: "separator" },
        {
          kind: "item",
          id: "find",
          label: "查找",
          accelerator: "Ctrl+F",
          run: () => {
            editorManager.openSearch();
          },
        },
        {
          kind: "item",
          id: "replace",
          label: "替换",
          accelerator: "Ctrl+H",
          run: () => {
            editorManager.openSearch();
          },
        },
      ],
    },
    {
      id: "view",
      label: "查看",
      items: [
        {
          kind: "item",
          id: "format",
          label: "格式化",
          accelerator: "Shift+Alt+F",
          run: formatActiveTab,
        },
        {
          kind: "item",
          id: "minify",
          label: "压缩 JSON",
          accelerator: "Shift+Alt+M",
          run: minifyActiveTab,
        },
        { kind: "separator" },
        themeSubmenu(themePref),
      ],
    },
    {
      id: "help",
      label: "帮助",
      items: [
        {
          kind: "item",
          id: "about",
          label: "关于 闪记",
          run: () => useStatusStore.getState().setAboutOpen(true),
        },
        { kind: "separator" },
        { kind: "item", id: "open-data-dir", label: "在资源管理器中打开数据目录", run: openDataDir },
      ],
    },
  ];
}
