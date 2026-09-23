import type { LanguageId } from "../types/models";

/**
 * 按内容猜语言。
 *
 * 只用于**没有文件名可依**的标签：新建的临时标签固定叫 `未命名 1-xxxxxxxx.txt`
 * （见 services/tempFiles.ts），扩展名给不出任何信息，只剩内容这一条线索。
 *
 * 设计取向是**宁可认不出来，也不要认错**：
 * - 每个语言都要求两条互相独立的证据（例如 Go 要 `package x` 且 `func`/`import (`），
 *   并且尽量锚在行首，避免把一段中文随笔里提到的关键词当成代码；
 * - 认不出来就回落到 JSON / YAML 嗅探，再不行就是纯文本（状态栏还能手动选）；
 * - 数组顺序即优先级。冲突处（`class A {}` 同属 Java 与 JS、`# 注释` 同属 Python 与
 *   Markdown、`[a]` + `=` 同属 TOML 与 INI）都把更具体的排在前面，
 *   逐条在 runtime/check-sniff.mjs 里有正/负样本。
 */

/** 只看前这么多字符：特征都是行内正则，长文档没必要整篇扫 */
export const SNIFF_HEAD_LIMIT = 64 * 1024;

type Test = (head: string) => boolean;

interface Signature {
  /** 命中时返回具体语言；未命中返回 null（JS 家族要在命中后再细分） */
  readonly match: (head: string) => LanguageId | null;
}

/** 全部成立 */
const all =
  (...patterns: readonly RegExp[]): Test =>
  (head) =>
    patterns.every((pattern) => pattern.test(head));

/** 任一成立 */
const either =
  (...tests: readonly Test[]): Test =>
  (head) =>
    tests.some((test) => test(head));

/** 全部成立，且任一成立 */
const allAny =
  (required: readonly RegExp[], any: readonly RegExp[]): Test =>
  (head) =>
    required.every((pattern) => pattern.test(head)) && any.some((pattern) => pattern.test(head));

/**
 * 主证据**任一**成立，且辅证据任一成立。
 * 用 `allAny` 表达「多个可选主证据」会写成「全部成立」的意思，是错的（踩过一次）。
 */
const someAndAny =
  (primary: readonly RegExp[], secondary: readonly RegExp[]): Test =>
  (head) =>
    primary.some((pattern) => pattern.test(head)) && secondary.some((pattern) => pattern.test(head));

/** 单一语言的特征条目 */
const when = (language: LanguageId, test: Test): Signature => ({
  match: (head) => (test(head) ? language : null),
});

/** 行首的声明语句（JS 家族用：不像 `class` 那样单独出现就算数） */
const JS_DECL = /^[ \t]*(?:const|let|var|function|class)\s+\w/m;
const JS_MODULE =
  /^[ \t]*import\s[^\n]*\bfrom\s*["']|^[ \t]*export\s+(?:default\s+)?(?:const|let|function|class)\b|\brequire\s*\(/m;
const JS_SYNTAX = /=>|[;{}]/;
/** TS 独有标记：类型注解、interface/type、修饰符、as 断言 */
const TS_MARKER =
  /^[ \t]*interface\s+\w+|^[ \t]*type\s+\w+\s*=|:\s*(?:string|number|boolean|void|unknown|never|any)\b|\b(?:public|private|protected|readonly)\s+\w+|\bas\s+\w+\s*[;,)]/m;
/** 闭合标签或自闭合标签 —— 泛型 `Array<Foo>` 这两样都没有 */
const JSX_MARKER = /<\/[A-Za-z][\w.:-]*>|[A-Za-z][\w.:-]*\s*\/>/;

/** JS 家族：命中后按 TS / JSX 标记细分 */
const javascriptFamily: Signature = {
  match: (head) => {
    if (!JS_DECL.test(head) && !JS_MODULE.test(head)) return null;
    if (!JS_SYNTAX.test(head)) return null;
    const jsx = JSX_MARKER.test(head);
    const typed = TS_MARKER.test(head);
    if (jsx) return typed ? "tsx" : "jsx";
    return typed ? "typescript" : "javascript";
  },
};

const SIGNATURES: readonly Signature[] = [
  // —— 有独一无二标记的语言先排，避免被后面的宽松规则抢走 ——
  // Go 的 package 子句必须顶格：缩进形式（JSON/YAML 里的同名串）不算
  when("go", allAny([/^package\s+[a-z]\w*\s*$/m], [/^func\s+\w/m, /^import\s*\(/m])),
  when(
    "rust",
    allAny([/^[ \t]*(?:fn|impl|struct|enum|trait|mod)\s+\w/m], [/->/, /\blet\s+mut\b/, /^use\s+[\w:]+;/m]),
  ),
  // Java 抢在 JS 前面：`class A {}` 两个家族都像，靠 main / package 子句 / System.out 区分
  when(
    "java",
    allAny(
      [/^[ \t]*(?:public\s+|final\s+|abstract\s+)*class\s+\w+/m],
      [/public\s+static\s+void\s+main\s*\(/, /^package\s+[\w.]+;/m, /System\.out\./],
    ),
  ),
  when("cpp", all(/^#include\s*[<"]/m)),
  when(
    "dockerfile",
    allAny([/^FROM\s+\S+/m], [/^(?:RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|ENV|EXPOSE|ARG|VOLUME)\b/m]),
  ),
  when("html", all(/^[ \t]*<!DOCTYPE\s+html|^[ \t]*<html[\s>]/im)),
  when(
    "xml",
    either(all(/^[ \t]*<\?xml[\s?]/m), all(/<\/[A-Za-z][\w.:-]*>/, /^[ \t]*<[A-Za-z][\w.:-]*[\s>/]/m)),
  ),
  when(
    "sql",
    allAny(
      [/^[ \t]*(?:SELECT|WITH|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/im],
      // FROM/WHERE 后面必须跟 ASCII 标识符：`FROM 也` 这种中文散文不算
      [/\bFROM\s+[A-Za-z_"`[]/i, /\bVALUES\s*\(/i, /\bWHERE\s+[A-Za-z_"`[]/i],
    ),
  ),
  when(
    "python",
    either(
      // `def f(...):` / `class X:` 顶格且以冒号结尾（Ruby 的 def 不以冒号结尾，靠这个分开）
      allAny(
        [/^[ \t]*(?:def|class)\s+\w[^\n]*:\s*$/m],
        [/^[ \t]+(?:return|pass|raise|yield|import|from)\b/m, /^if\s+__name__\s*==/m, /\bself\b/],
      ),
      // 只有 import 形式时，要求再加一条 Python 独有的写法
      allAny(
        [/^[ \t]*(?:import\s+[\w.]+|from\s+[\w.]+\s+import\s)/m],
        [/\bTrue\b|\bFalse\b|\bNone\b/, /\bprint\s*\(/, /^\s*#.*coding[:=]/m],
      ),
    ),
  ),
  when(
    "ruby",
    allAny(
      [/^[ \t]*def\s+\w+[!?]?\s*(?:\(|$)/m],
      [/\bend\s*$/m, /\bputs\b/, /\brequire\s+["']/, /\.each\s+do\b/, /attr_(?:accessor|reader|writer)\b/],
    ),
  ),
  when(
    "lua",
    allAny(
      [/^[ \t]*(?:local\s+function|function\s*[\w.:]*\s*\(|local\s+\w+\s*=)/m],
      [/^[ \t]*end\b/m, /\bthen\b/, /\bnil\b/],
    ),
  ),
  when(
    "perl",
    allAny([/^[ \t]*use\s+(?:strict|warnings)\s*;/m], [/\bmy\s+[$@%]\w+/, /^[ \t]*sub\s+\w+/m, /\bchomp\b/]),
  ),
  when("r", allAny([/<-/], [/\bfunction\s*\(/, /\blibrary\s*\(/, /\bc\s*\(/])),
  when(
    "powershell",
    someAndAny(
      [/^[ \t]*\$\w+\s*=/m, /^[ \t]*param\s*\(/m, /^[ \t]*function\s+[A-Z][\w-]*/m],
      [
        /\b(?:Get|Set|New|Remove|Write|Start|Stop|Test|Invoke|Select|Where|ForEach)-[A-Z]\w+/,
        /\$env:/,
        /\$_/,
        /-ErrorAction\b/,
      ],
    ),
  ),
  when(
    "shell",
    either(
      all(/^#!.*\b(?:ba|z|k)?sh\b/),
      allAny(
        [/^[ \t]*(?:export\s+)?[A-Za-z_]\w*=[^\s=]+$/m],
        [/\b(?:done|fi|esac)\b/, /\$\(/, /\$\{/, /\bfunction\s+\w+\s*\(\)/],
      ),
    ),
  ),
  // TOML 与 INI 的形状在这里无法区分，统一按 ini 高亮（都是段落 + 键值）
  when("ini", all(/^[ \t]*\[[\w.]+\]\s*$/m, /^[ \t]*[\w.-]+\s*=\s*\S/m)),
  javascriptFamily,
  // Markdown 排在所有代码语言之后：它的 `# 标题` 与 Python/Shell 的注释同形
  when(
    "markdown",
    either(
      all(/^```/m),
      all(/\]\([^)\s]+\)/),
      all(/\*\*[^*\n]+\*\*/),
      all(/^#{1,6}\s+\S/m, /^[ \t]*[-*+]\s+\S/m),
    ),
  ),
];

/** 依内容特征猜语言；认不出来返回 null */
export function sniffBySignature(source: string): LanguageId | null {
  if (source.length === 0) return null;
  const head = source.length > SNIFF_HEAD_LIMIT ? source.slice(0, SNIFF_HEAD_LIMIT) : source;
  for (const signature of SIGNATURES) {
    const hit = signature.match(head);
    if (hit !== null) return hit;
  }
  return null;
}
