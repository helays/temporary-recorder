import { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";
import type { ResolvedTheme } from "../types/models";

/** 与主题无关的外观：字体、内边距、填满容器 */
const sharedChrome = EditorView.theme({
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

/** 浅色外观。配色用 defaultHighlightStyle（它就是为浅底设计的） */
const lightChrome = EditorView.theme(
  {
    "&": { backgroundColor: "var(--app-bg)", color: "var(--app-fg)" },
    ".cm-gutters": { backgroundColor: "var(--app-bg)", color: "var(--app-muted)" },
    ".cm-activeLine": { backgroundColor: "var(--app-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--app-hover)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(9, 105, 218, 0.22)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--app-fg)" },
    ".cm-searchMatch": { backgroundColor: "rgba(255, 196, 0, 0.45)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(255, 140, 0, 0.6)" },
    ".cm-panels": { backgroundColor: "var(--app-panel)", color: "var(--app-fg)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--app-border)" },
  },
  { dark: false },
);

/**
 * 深色只覆盖背景与搜索高亮，语法配色交给 one-dark。
 * 背景对齐 --app-bg（取值即为 one-dark 的 #282c34），所以外壳与编辑器不会出现色差。
 */
const darkChrome = EditorView.theme(
  {
    "&": { backgroundColor: "var(--app-bg)" },
    ".cm-gutters": { backgroundColor: "var(--app-bg)", color: "var(--app-muted)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(97, 175, 239, 0.28)",
    },
    ".cm-panels": { backgroundColor: "var(--app-panel)", color: "var(--app-fg)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--app-border)" },
  },
  { dark: true },
);

/** 依主题给出完整的编辑器外观扩展；通过 Compartment 装载以便热切换 */
export function editorThemeExtension(theme: ResolvedTheme): Extension {
  return theme === "dark"
    ? [oneDark, darkChrome, sharedChrome]
    : [
        lightChrome,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        sharedChrome,
      ];
}
