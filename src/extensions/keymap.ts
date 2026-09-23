import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";

export interface AppKeymapHandlers {
  newTab: () => void;
  closeTab: () => void;
  nextTab: () => void;
  previousTab: () => void;
  /** index 为 0 基下标，对应 Ctrl+1 .. Ctrl+9 */
  switchToIndex: (index: number) => void;
  format: () => void;
  minify: () => void;
  /** 打开文件（Ctrl+O） */
  openFile: () => void;
  /** 保存当前标签（Ctrl+S）；临时标签会转为「另存为」 */
  save: () => void;
  /** 另存为（Ctrl+Shift+S） */
  saveAs: () => void;
  /** 打开设置（Ctrl+,） */
  openSettings: () => void;
}

/**
 * 应用级快捷键。
 * 放在 defaultKeymap / searchKeymap 之前，因此优先级更高；
 * 未在此声明的按键（如 Ctrl+D 选下一个相同词、Alt+Click 多光标）继续走 CodeMirror 默认行为。
 */
export function appKeymap(handlers: AppKeymapHandlers): Extension {
  const run = (fn: () => void) => (): boolean => {
    fn();
    return true;
  };

  return [
    keymap.of([
      { key: "Mod-t", run: run(handlers.newTab), preventDefault: true },
      // Ctrl+N 与 Ctrl+T 都新建标签；Ctrl+N 不在 WebView2 的浏览器加速键列表里，
      // 所以不会被 WebView2 抢走（Ctrl+F/Ctrl+P/Ctrl+R 才会，见 lib.rs 的处理）。
      { key: "Mod-n", run: run(handlers.newTab), preventDefault: true },
      { key: "Mod-w", run: run(handlers.closeTab), preventDefault: true },
      { key: "Mod-s", run: run(handlers.save), preventDefault: true },
      { key: "Mod-o", run: run(handlers.openFile), preventDefault: true },
      { key: "Mod-Shift-s", run: run(handlers.saveAs), preventDefault: true },
      { key: "Mod-,", run: run(handlers.openSettings), preventDefault: true },
      // Ctrl+H 打开替换：CodeMirror 的搜索面板本身包含替换输入框
      { key: "Mod-h", run: openSearchPanel, preventDefault: true },
      { key: "Mod-Tab", run: run(handlers.nextTab), preventDefault: true },
      { key: "Mod-Shift-Tab", run: run(handlers.previousTab), preventDefault: true },
      { key: "Mod-PageDown", run: run(handlers.nextTab), preventDefault: true },
      { key: "Mod-PageUp", run: run(handlers.previousTab), preventDefault: true },
      { key: "Shift-Alt-f", run: run(handlers.format), preventDefault: true },
      { key: "Shift-Alt-m", run: run(handlers.minify), preventDefault: true },
      ...Array.from({ length: 9 }, (_, index) => ({
        key: `Mod-${index + 1}`,
        run: run(() => handlers.switchToIndex(index)),
        preventDefault: true,
      })),
    ]),
    keymap.of(defaultKeymap),
    keymap.of(historyKeymap),
    keymap.of([indentWithTab]),
  ];
}
