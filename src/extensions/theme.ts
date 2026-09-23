import { EditorView } from "@codemirror/view";

/**
 * 应用自有编辑器样式：填满容器、统一字体与内边距。
 * 配色由 one-dark 主题提供（见 editorManager）。
 */
export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily:
      "Consolas, 'Cascadia Mono', 'Courier New', 'Microsoft YaHei', monospace",
    lineHeight: "1.6",
  },
  ".cm-content": {
    padding: "8px 0",
  },
  ".cm-gutters": {
    border: "none",
  },
  "&.cm-focused": {
    outline: "none",
  },
});
