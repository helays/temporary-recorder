import { indentService, type IndentContext } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";

/**
 * YAML 换行缩进的兜底规则。
 *
 * lang-yaml 自带的缩进走解析树的 `indentNodeProp`，只有块结构已经成形时才给得出缩进。
 * 于是从零手写 YAML 时——刚敲完 `key:` 就回车——缩进是 null，新行直接顶格，
 * 得自己敲空格。实测（runtime/explore-yaml-indent.mjs）：
 *
 *   "key:"                      → getIndentation = 0
 *   "key:\n"                    → null      ← 正是回车后的真实状态
 *   "outer:\n  inner:\n"        → 2         ← 其实应该是 4（inner 的子级）
 *
 * 这里在语言之前补一条规则：上一行以 `:` 结尾（键后无值）时，在其基础上再缩进一级。
 *
 * 关键：其余情况必须返回 **undefined** 而不是 null。
 * getIndentation 的判断是 `result !== undefined` 才继续往下问下一个服务，
 * 返回 null 会被当成"有意见"而直接返回，把语言自己本来正确的规则也一起挡掉。
 */
export const yamlIndentFallback: Extension = Prec.high(
  indentService.of((context: IndentContext, pos: number): number | null | undefined => {
    const { state } = context;
    const line = state.doc.lineAt(pos);

    // 只对空行（也就是刚插入的那一行）表态
    if (line.text.trim().length > 0) return undefined;
    if (line.number <= 1) return undefined;

    const previous = state.doc.line(line.number - 1);
    const trimmed = previous.text.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return undefined;
    // 只处理「键后无值」：`key:` / `- key:`；`key: value` 不干预
    if (!trimmed.endsWith(":")) return undefined;

    const previousIndent = previous.text.length - previous.text.trimStart().length;
    return previousIndent + 2;
  }),
);
