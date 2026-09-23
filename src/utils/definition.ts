import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import type { LanguageId } from "../types/models";

/**
 * 「跳转到定义」的纯逻辑：只吃语法树与文档，不碰 DOM / EditorView，
 * 所以能在 node 里直接断言（见 runtime/check-jump.mjs）。
 *
 * 各语言的节点名不是凭记忆写的，来源是实测转储（runtime/probe-defs*.txt）：
 *   - `identifiers`：光标下可能是标识符的节点名（引用与定义都算）；
 *   - `declarationNames`：节点名本身就代表定义（如 JS 的 VariableDefinition）；
 *   - `declarationPairs`：要看父节点才能判定的定义，形如 (父节点名, 子节点名)，
 *     可再给一个「分隔符」——只有出现在该分隔符之前的同名子节点才算定义
 *     （Python 的 `a, b = 1, 2` 里 `=` 左边的 a、b 是定义，右边不是）。
 *
 * 只做同一文件内的查找，不做跨文件、不解析 import。
 */

type SyntaxTree = ReturnType<typeof syntaxTree>;
type TreeNode = SyntaxTree["topNode"];

/** 标识符形态：字母 / 下划线 / $ 开头，后接字母数字下划线（含中日韩等 Unicode 字母） */
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

export interface DefinitionSite {
  readonly from: number;
  readonly to: number;
}

export interface DefinitionTarget extends DefinitionSite {
  readonly name: string;
  /** 光标下标识符的范围（悬停高亮用） */
  readonly at: DefinitionSite;
}

export type DefinitionLookup =
  | { readonly kind: "found"; readonly target: DefinitionTarget }
  /** 光标已经在该名字的定义处 */
  | { readonly kind: "self"; readonly name: string }
  /** 该名字在本文件里找不到定义 */
  | { readonly kind: "missing"; readonly name: string }
  /** 光标不在标识符上 */
  | { readonly kind: "empty" }
  /** 这种语言没有定义可跳（纯文本、Markdown、SQL、JSON 等） */
  | { readonly kind: "unsupported" };

interface JumpRule {
  readonly identifiers: readonly string[];
  readonly declarationNames?: readonly string[];
  readonly declarationPairs?: readonly (readonly [parent: string, child: string, stopAt?: string])[];
  /** 名字前缀要剥掉的符号（YAML 的 &anchor / *alias） */
  readonly sigil?: RegExp;
}

const JAVASCRIPT: JumpRule = {
  identifiers: [
    "VariableName",
    "PropertyName",
    "TypeName",
    "VariableDefinition",
    "PropertyDefinition",
    "PrivatePropertyDefinition",
    "TypeDefinition",
  ],
  declarationNames: ["VariableDefinition", "PropertyDefinition", "PrivatePropertyDefinition", "TypeDefinition"],
  // TS 枚举成员：EnumBody 下的 PropertyName 是定义，别处的 PropertyName（成员访问）是引用
  declarationPairs: [["EnumBody", "PropertyName"]],
};

const PYTHON: JumpRule = {
  identifiers: ["VariableName", "PropertyName"],
  declarationPairs: [
    ["FunctionDefinition", "VariableName"],
    ["ClassDefinition", "VariableName"],
    ["AssignStatement", "VariableName", "AssignOp"],
    ["ImportStatement", "VariableName"],
    ["ParamList", "VariableName"],
    // `for i in items:` —— `in` 之前的是循环变量，之后的是被遍历对象
    ["ForStatement", "VariableName", "in"],
    ["WithStatement", "VariableName"],
  ],
};

const RUST: JumpRule = {
  identifiers: ["Identifier", "BoundIdentifier", "TypeIdentifier", "FieldIdentifier"],
  // BoundIdentifier 只用于绑定（fn 名、let、参数、const），本身就是定义
  declarationNames: ["BoundIdentifier"],
  declarationPairs: [
    ["StructItem", "TypeIdentifier"],
    ["EnumItem", "TypeIdentifier"],
    ["TypeItem", "TypeIdentifier"],
    ["TraitItem", "TypeIdentifier"],
    ["FieldDeclaration", "FieldIdentifier"],
    ["EnumVariant", "Identifier"],
  ],
};

const GO: JumpRule = {
  identifiers: ["VariableName", "TypeName", "DefName", "FieldName"],
  declarationNames: ["DefName"],
  // 结构体字段 / 方法名用 FieldName，选择表达式里的 FieldName 是引用
  declarationPairs: [
    ["FieldDecl", "FieldName"],
    ["MethodDecl", "FieldName"],
  ],
};

const JAVA: JumpRule = {
  identifiers: ["Identifier", "TypeName", "MethodName", "Definition"],
  declarationNames: ["Definition"],
};

const CPP: JumpRule = {
  identifiers: ["Identifier", "TypeIdentifier", "NamespaceIdentifier", "FieldIdentifier"],
  declarationPairs: [
    // `int total = 1;` 的名字在 InitDeclarator 里，`Box b;` 的名字直接挂在 Declaration 下
    ["InitDeclarator", "Identifier"],
    ["Declaration", "Identifier"],
    ["ParameterDeclaration", "Identifier"],
    ["FunctionDeclarator", "Identifier"],
    ["FunctionDeclarator", "FieldIdentifier"],
    ["FieldDeclaration", "FieldIdentifier"],
    ["NamespaceDefinition", "Identifier"],
    ["StructSpecifier", "TypeIdentifier"],
    ["ClassSpecifier", "TypeIdentifier"],
    ["EnumSpecifier", "TypeIdentifier"],
  ],
};

const YAML: JumpRule = {
  // &anchor 是定义，*alias 是引用，名字要剥掉前缀符号
  identifiers: ["Anchor", "Alias"],
  declarationNames: ["Anchor"],
  sigil: /^[&*]/,
};

const JUMP_RULES: Partial<Record<LanguageId, JumpRule>> = {
  javascript: JAVASCRIPT,
  jsx: JAVASCRIPT,
  typescript: JAVASCRIPT,
  tsx: JAVASCRIPT,
  python: PYTHON,
  rust: RUST,
  go: GO,
  java: JAVA,
  cpp: CPP,
  yaml: YAML,
};

interface CompiledRule {
  /** 可能是标识符的节点名（含定义节点），用于遍历时剪枝 */
  candidates: ReadonlySet<string>;
  declarationNames: ReadonlySet<string>;
  /** 父节点名 -> 该父节点下的定义子节点 */
  pairs: ReadonlyMap<string, readonly { child: string; stopAt: string | null }[]>;
  sigil: RegExp | null;
}

function compile(rule: JumpRule): CompiledRule {
  const candidates = new Set<string>(rule.identifiers);
  const pairs = new Map<string, { child: string; stopAt: string | null }[]>();
  for (const [parent, child, stopAt] of rule.declarationPairs ?? []) {
    candidates.add(parent);
    candidates.add(child);
    const list = pairs.get(parent) ?? [];
    list.push({ child, stopAt: stopAt ?? null });
    pairs.set(parent, list);
  }
  const declarationNames = new Set(rule.declarationNames ?? []);
  for (const name of declarationNames) candidates.add(name);
  return { candidates, declarationNames, pairs, sigil: rule.sigil ?? null };
}

const RULES = new Map<LanguageId, CompiledRule>(
  Object.entries(JUMP_RULES).map(([id, rule]) => [id as LanguageId, compile(rule as JumpRule)]),
);

/** 该语言是否支持跳转到定义 */
export function supportsJump(language: LanguageId): boolean {
  return RULES.has(language);
}

function nameOf(node: TreeNode, doc: Text, rule: CompiledRule): string | null {
  const raw = doc.sliceString(node.from, node.to);
  const name = rule.sigil === null ? raw : raw.replace(rule.sigil, "");
  return IDENTIFIER.test(name) ? name : null;
}

/** 取光标下的标识符节点：先按 pos，再按 pos-1（光标停在词尾时用得上） */
function identifierAt(
  tree: SyntaxTree,
  doc: Text,
  pos: number,
  rule: CompiledRule,
): { node: TreeNode; name: string } | null {
  const probes = pos > 0 ? [pos, pos - 1] : [pos];
  for (const probe of probes) {
    let node: TreeNode | null = tree.resolveInner(probe, 1);
    while (node !== null) {
      if (rule.candidates.has(node.name)) {
        const name = nameOf(node, doc, rule);
        if (name !== null) return { node, name };
      }
      node = node.parent;
    }
  }
  return null;
}

function isDeclaration(node: TreeNode, rule: CompiledRule): boolean {
  if (rule.declarationNames.has(node.name)) return true;
  const parent = node.parent;
  if (parent === null) return false;
  const pairs = rule.pairs.get(parent.name);
  if (pairs === undefined) return false;

  for (const pair of pairs) {
    if (pair.child !== node.name) continue;
    if (pair.stopAt === null) return true;
    for (let sibling = parent.firstChild; sibling !== null && sibling.from < node.from; sibling = sibling.nextSibling) {
      // 分隔符之前才算定义；之后出现的同名节点是引用
      if (sibling.name === pair.stopAt) return false;
    }
    return true;
  }
  return false;
}

type Index = Map<string, DefinitionSite[]>;

/**
 * 名字 -> 定义位置，按出现顺序排列。
 * 按语法树对象缓存：CodeMirror 在文档未变时复用同一个 Tree 实例，改了就给新实例，
 * 于是缓存自动失效，不需要额外维护版本号。
 */
const indexes = new WeakMap<SyntaxTree, Map<LanguageId, Index>>();

function indexFor(tree: SyntaxTree, doc: Text, language: LanguageId, rule: CompiledRule): Index {
  let byLanguage = indexes.get(tree);
  if (byLanguage === undefined) {
    byLanguage = new Map();
    indexes.set(tree, byLanguage);
  }
  const cached = byLanguage.get(language);
  if (cached !== undefined) return cached;

  const index: Index = new Map();
  tree.iterate({
    enter: (ref) => {
      const node = ref.node;
      if (!rule.candidates.has(ref.name)) return;
      if (!isDeclaration(node, rule)) return;
      const name = nameOf(node, doc, rule);
      if (name === null) return;
      const list = index.get(name);
      if (list === undefined) index.set(name, [{ from: node.from, to: node.to }]);
      else list.push({ from: node.from, to: node.to });
    },
  });

  byLanguage.set(language, index);
  return index;
}

/**
 * 查光标处标识符的定义位置。
 * 同一个名字有多处定义时取光标之前最近的一处（局部变量重名时符合直觉），
 * 都在光标之后则取第一处。
 */
export function findDefinition(
  tree: SyntaxTree,
  doc: Text,
  pos: number,
  language: LanguageId,
): DefinitionLookup {
  const rule = RULES.get(language);
  if (rule === undefined) return { kind: "unsupported" };

  const at = identifierAt(tree, doc, pos, rule);
  if (at === null) return { kind: "empty" };
  if (isDeclaration(at.node, rule)) return { kind: "self", name: at.name };

  const sites = indexFor(tree, doc, language, rule).get(at.name);
  if (sites === undefined || sites.length === 0) return { kind: "missing", name: at.name };

  let best = sites[0];
  for (const site of sites) {
    if (site.from >= at.node.from) break;
    best = site;
  }
  if (best.from === at.node.from) return { kind: "self", name: at.name };

  return {
    kind: "found",
    target: { name: at.name, at: { from: at.node.from, to: at.node.to }, from: best.from, to: best.to },
  };
}
