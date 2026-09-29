import { editorManager } from "../extensions/editorManager";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import { openFileIntoNewTab, saveActiveTab, saveActiveTabAs } from "./fileActions";
import { formatActiveTab, minifyActiveTab } from "./formatActions";

/**
 * 窗口级快捷键兜底。
 *
 * 原生菜单栏在时，Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+W 这些由菜单加速键在**窗口层**生效；
 * 换成自绘菜单后没有加速键了，它们只在编辑器有焦点时由 CodeMirror 的 keymap 处理。
 * 这里补一层窗口级监听，让焦点在标签栏 / 状态栏 / 按钮上时同样可用。
 *
 * 两个关键守卫：
 * - `event.defaultPrevented`：CodeMirror 已经处理过的按键会 preventDefault，
 *   直接跳过，避免同一个动作执行两次。
 * - 只认 Ctrl：Windows 上 Meta 是 Win 键，带上它会和系统快捷键打架。
 */
export function installWindowShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;

    if (event.ctrlKey) {
      // 折叠：Ctrl+Alt+[ / ] 全部折叠 / 全部展开。
      // 必须按 event.code 判断——Shift+[ 的 event.key 是 "{"、Shift+] 是 "}"，
      // 用 event.key 会静默失效。这里只认这两个 code，其余 Ctrl+Alt+* 组合
      // 照旧落回下面的分支（不提前 return，免得顺手改掉现有行为）。
      if (event.altKey) {
        if (event.code === "BracketLeft") {
          event.preventDefault();
          editorManager.foldAll();
          return;
        }
        if (event.code === "BracketRight") {
          event.preventDefault();
          editorManager.unfoldAll();
          return;
        }
      }

      if (event.shiftKey) {
        if (event.key === "S" || event.key === "s") {
          event.preventDefault();
          void saveActiveTabAs();
        } else if (event.key === "Tab") {
          event.preventDefault();
          void useTabsStore.getState().cycleTab(-1);
        } else if (event.code === "BracketLeft") {
          // Ctrl+Shift+[：折叠当前区域
          event.preventDefault();
          editorManager.foldAtCursor();
        } else if (event.code === "BracketRight") {
          // Ctrl+Shift+]：展开当前区域
          event.preventDefault();
          editorManager.unfoldAtCursor();
        }
        return;
      }

      switch (event.key) {
        case "n":
        case "N":
        case "t":
        case "T":
          event.preventDefault();
          void useTabsStore.getState().createTab();
          return;
        case "o":
        case "O":
          event.preventDefault();
          void openFileIntoNewTab();
          return;
        case "s":
        case "S":
          event.preventDefault();
          void saveActiveTab();
          return;
        case "w":
        case "W": {
          const id = useTabsStore.getState().activeTabId;
          if (id === null) return;
          event.preventDefault();
          void useTabsStore.getState().closeTab(id);
          return;
        }
        case ",":
          event.preventDefault();
          useStatusStore.getState().setSettingsOpen(true);
          return;
        case "f":
        case "F":
          // 编辑器有焦点时由 CodeMirror 的 searchKeymap 处理；这里兜住焦点在别处的情况
          event.preventDefault();
          editorManager.openSearch();
          return;
        case "r":
        case "R":
          // 替换：与 Ctrl+F 同一个面板（面板里带替换输入框）
          event.preventDefault();
          editorManager.openSearch();
          return;
        case "g":
        case "G":
          event.preventDefault();
          editorManager.goToLine();
          return;
        case "Tab":
          event.preventDefault();
          void useTabsStore.getState().cycleTab(1);
          return;
        case "PageDown":
          event.preventDefault();
          void useTabsStore.getState().cycleTab(1);
          return;
        case "PageUp":
          event.preventDefault();
          void useTabsStore.getState().cycleTab(-1);
          return;
        default:
          break;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        void useTabsStore.getState().activateIndex(Number(event.key) - 1);
      }
      return;
    }

    // Shift+Alt+F / Shift+Alt+M：格式化与压缩
    if (event.altKey && event.shiftKey) {
      if (event.key === "F" || event.key === "f") {
        event.preventDefault();
        formatActiveTab();
      } else if (event.key === "M" || event.key === "m") {
        event.preventDefault();
        minifyActiveTab();
      }
      return;
    }

    // F1：使用说明（不带任何修饰键）
    if (event.key === "F1") {
      event.preventDefault();
      useStatusStore.getState().setHelpOpen(true);
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
