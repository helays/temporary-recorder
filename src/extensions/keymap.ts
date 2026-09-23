import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { gotoLine, openSearchPanel } from "@codemirror/search";

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
  /** 打开使用说明（F1 或 帮助 ▸ 使用说明） */
  openHelp: () => void;
}

/**
 * 应用级快捷键。
 * 放在 defaultKeymap / searchKeymap 之前，因此优先级更高；
 * 未在此声明的按键（如 Ctrl+D 选下一个相同词、Alt+Click 多光标）继续走 CodeMirror 默认行为。
 *
 * 与搜索有关的三条：Ctrl+F（searchKeymap 自带）、Ctrl+R（这里补）、Ctrl+G（这里补，到行）。
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
      // Ctrl+F / Ctrl+R 都打开搜索面板（面板里同时有搜索与替换两个输入框）。
      // Ctrl+F 由 CodeMirror 的 searchKeymap 提供，这里只补 Ctrl+R，
      // 并且让它在编辑器的任何位置都能用（不再有 Ctrl+H 别名）。
      { key: "Mod-r", run: openSearchPanel, preventDefault: true },
      { key: "F1", run: run(handlers.openHelp), preventDefault: true },
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
    /**
     * Ctrl+G 转到行。
     * 单独用 Prec.highest 包一层：CodeMirror 的 searchKeymap 里也有一条 `Mod-g`
     * （面板内的「下一个匹配」，带 scope），靠扩展顺序决定谁赢是运气，
     * 显式提高优先级才稳。面板里的 F3 / Shift-F3 与 Ctrl+Alt+G 不受影响。
     */
    Prec.highest(keymap.of([{ key: "Mod-g", run: gotoLine, preventDefault: true }])),
    keymap.of(defaultKeymap),
    keymap.of(historyKeymap),
    keymap.of([indentWithTab]),
  ];
}
