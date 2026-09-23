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
  /** 立即落库（Ctrl+S） */
  flush: () => void;
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
      { key: "Mod-w", run: run(handlers.closeTab), preventDefault: true },
      { key: "Mod-s", run: run(handlers.flush), preventDefault: true },
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
