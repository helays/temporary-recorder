import { getVersion } from "@tauri-apps/api/app";
import {
  CheckMenuItem,
  Menu,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { appDataDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { editorManager } from "../extensions/editorManager";
import { useSettingsStore } from "../stores/settingsStore";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import type { ThemePref } from "../types/models";
import { openFileIntoNewTab, saveActiveTab, saveActiveTabAs } from "./fileActions";
import { revealPath } from "./fileService";
import { formatActiveTab, minifyActiveTab } from "./formatActions";
import { cleanOrphanTempFiles, describeCleanup } from "./tempCleanup";
import { effectiveTempDir } from "./tempFiles";

/**
 * 原生菜单栏。
 *
 * 菜单是 Tauri 的核心能力（不需要额外的 Cargo feature，`core:default` 里已包含
 * `core:menu:default`），所以这里完全用 JS 侧 API 构建，Rust 侧不需要改。
 *
 * 刻意留在状态栏、不放进菜单的：格式化 / 压缩 —— 这两个按钮本来就在状态栏，
 * 菜单里再放一份（查看 ▸）是为了让不看状态栏的人也能找到。
 */

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 菜单动作统一包一层：异步失败也要落到状态栏，不能变成 unhandled rejection */
function action(run: () => void | Promise<void>): (id: string) => void {
  return () => {
    void Promise.resolve()
      .then(run)
      .catch((err: unknown) => {
        console.error("[menu] 菜单动作失败:", err);
        useStatusStore.getState().setMessage({
          kind: "error",
          text: `菜单操作失败：${describeError(err)}`,
        });
      });
  };
}

function separator(): PredefinedMenuItemOptions {
  return { item: "Separator" };
}

/** 退出：走窗口的 close()，让 onCloseRequested 里的强制落盘照常执行 */
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

async function cleanTempFiles(): Promise<void> {
  const result = await cleanOrphanTempFiles();
  // 取消是用户的正常选择，不必再往状态栏写一句
  if (result.cancelled) return;
  useStatusStore.getState().setMessage({ kind: "info", text: describeCleanup(result) });
}

/** 主题三选一。用 CheckMenuItem 是为了让菜单里能看出当前选的是哪个 */
const THEME_ITEMS: Array<{ pref: ThemePref; text: string }> = [
  { pref: "system", text: "跟随系统" },
  { pref: "light", text: "浅色" },
  { pref: "dark", text: "深色" },
];

let themeChecks: CheckMenuItem[] = [];

async function buildThemeChecks(): Promise<CheckMenuItem[]> {
  const current = useSettingsStore.getState().themePref;
  return Promise.all(
    THEME_ITEMS.map((item) =>
      CheckMenuItem.new({
        id: `menu-theme-${item.pref}`,
        text: item.text,
        checked: item.pref === current,
        action: action(() => {
          useSettingsStore.getState().setThemePref(item.pref);
        }),
      }),
    ),
  );
}

/** 把三个勾选项对齐到当前偏好。设置面板里改主题时也会走到这里 */
function syncThemeChecks(pref: ThemePref): void {
  THEME_ITEMS.forEach((item, index) => {
    const check = themeChecks[index];
    if (check === undefined) return;
    void check.setChecked(item.pref === pref).catch((err: unknown) => {
      console.error("[menu] 同步主题勾选失败:", err);
    });
  });
}

let installed = false;

/**
 * 构建并安装应用菜单栏。
 * 失败只记日志与状态栏，不阻断启动——菜单挂了应用仍然能用。
 */
export async function installAppMenu(): Promise<void> {
  if (installed) return;
  installed = true;

  try {
    themeChecks = await buildThemeChecks();
    const version = await getVersion();

    const fileMenu: SubmenuOptions = {
      text: "文件",
      items: [
        {
          id: "menu-new-tab",
          text: "新建标签",
          accelerator: "CmdOrCtrl+N",
          action: action(() => useTabsStore.getState().createTab()),
        },
        {
          id: "menu-open-file",
          text: "打开…",
          accelerator: "CmdOrCtrl+O",
          action: action(openFileIntoNewTab),
        },
        separator(),
        {
          id: "menu-save",
          text: "保存",
          accelerator: "CmdOrCtrl+S",
          action: action(saveActiveTab),
        },
        {
          id: "menu-save-as",
          text: "另存为…",
          accelerator: "CmdOrCtrl+Shift+S",
          action: action(saveActiveTabAs),
        },
        separator(),
        {
          id: "menu-close-tab",
          text: "关闭当前标签",
          accelerator: "CmdOrCtrl+W",
          action: action(closeActiveTab),
        },
        separator(),
        {
          id: "menu-quit",
          text: "退出",
          action: action(quitApp),
        },
      ],
    };

    const settingsMenu: SubmenuOptions = {
      text: "设置",
      items: [
        {
          id: "menu-open-settings",
          text: "打开设置…",
          accelerator: "CmdOrCtrl+,",
          action: action(() => {
            useStatusStore.getState().setSettingsOpen(true);
          }),
        },
        separator(),
        {
          id: "menu-open-temp-dir",
          text: "在资源管理器中打开临时目录",
          action: action(openTempDir),
        },
        {
          id: "menu-clean-temp",
          text: "清理未使用的临时文件",
          action: action(cleanTempFiles),
        },
      ],
    };

    const editMenu: SubmenuOptions = {
      text: "编辑",
      items: [
        // 撤销/重做走 CodeMirror 自己的历史栈：原生 Undo 不认它的历史，会把撤销变成空操作
        {
          id: "menu-undo",
          text: "撤销",
          accelerator: "CmdOrCtrl+Z",
          action: action(() => {
            editorManager.undo();
          }),
        },
        {
          id: "menu-redo",
          text: "重做",
          accelerator: "CmdOrCtrl+Shift+Z",
          action: action(() => {
            editorManager.redo();
          }),
        },
        separator(),
        // 剪贴板交给原生项：它把系统命令转发给 WebView，CodeMirror 依赖的
        // 剪贴板事件照常触发。这三项自带 Windows 标准快捷键。
        { item: "Cut", text: "剪切" },
        { item: "Copy", text: "复制" },
        { item: "Paste", text: "粘贴" },
        // 全选反过来：CodeMirror 自己有命令，走 action 就不必依赖原生命令转发，
        // 少一个「按了 Ctrl+A 没反应」的失败可能。
        {
          id: "menu-select-all",
          text: "全选",
          accelerator: "CmdOrCtrl+A",
          action: action(() => {
            editorManager.selectAll();
          }),
        },
        separator(),
        {
          id: "menu-find",
          text: "查找",
          accelerator: "CmdOrCtrl+F",
          action: action(() => {
            editorManager.openSearch();
          }),
        },
        {
          id: "menu-replace",
          text: "替换",
          accelerator: "CmdOrCtrl+H",
          action: action(() => {
            editorManager.openSearch();
          }),
        },
      ],
    };

    const viewMenu: SubmenuOptions = {
      text: "查看",
      items: [
        {
          id: "menu-format",
          text: "格式化",
          accelerator: "Shift+Alt+F",
          action: action(formatActiveTab),
        },
        {
          id: "menu-minify",
          text: "压缩 JSON",
          accelerator: "Shift+Alt+M",
          action: action(minifyActiveTab),
        },
        separator(),
        {
          id: "menu-theme",
          text: "主题",
          items: themeChecks,
        },
      ],
    };

    const helpMenu: SubmenuOptions = {
      text: "帮助",
      items: [
        {
          text: "关于 闪记",
          item: {
            About: {
              name: "闪记",
              version,
              comments: "轻量级临时记录器：快速打开、随手记录、随时关闭。",
            },
          },
        },
        separator(),
        {
          id: "menu-open-data-dir",
          text: "在资源管理器中打开数据目录",
          action: action(openDataDir),
        },
      ],
    };

    const menu = await Menu.new({
      items: [fileMenu, settingsMenu, editMenu, viewMenu, helpMenu],
    });
    await menu.setAsAppMenu();

    // 设置面板里改主题时，菜单里的勾选也要跟着变
    useSettingsStore.subscribe((state, previous) => {
      if (state.themePref !== previous.themePref) syncThemeChecks(state.themePref);
    });

    console.info("[menu] 已安装应用菜单栏");
  } catch (err) {
    console.error("[menu] 安装应用菜单栏失败:", err);
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `菜单栏不可用（快捷键不受影响）：${describeError(err)}`,
    });
  }
}
