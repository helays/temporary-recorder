import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { DocFormat, LanguageId } from "../types/models";
import { yamlIndentFallback } from "../extensions/yamlIndent";
import { detectFormat } from "./format";
import { sniffBySignature } from "./sniff";

interface Specs {
  alias?: string[];
  /** 扩展名，不带点，小写 */
  extensions?: string[];
  /** 无扩展名或扩展名不可靠的文件（如 Dockerfile）用正则匹配 */
  filename?: RegExp;
}

interface Entry {
  id: LanguageId;
  desc: LanguageDescription;
  /** 语言本体之外还要挂载的扩展（如 YAML 的续行缩进） */
  extra?: Extension;
}

function entry(
  id: LanguageId,
  name: string,
  specs: Specs,
  load: () => Promise<LanguageSupport>,
  extra?: Extension,
): Entry {
  return {
    id,
    desc: LanguageDescription.of({
      name,
      alias: specs.alias,
      extensions: specs.extensions,
      filename: specs.filename,
      load,
    }),
    extra,
  };
}

/** Lezer 语法包（体积大，全部动态导入） */
function lezer(
  id: LanguageId,
  name: string,
  specs: Specs,
  load: () => Promise<LanguageSupport>,
): Entry {
  return entry(id, name, specs, load);
}

/** legacy-modes 的 stream parser，同样动态导入，加载后包一层 LanguageSupport */
function stream(
  id: LanguageId,
  name: string,
  specs: Specs,
  mode: () => Promise<StreamParser<unknown>>,
): Entry {
  return entry(id, name, specs, async () => new LanguageSupport(StreamLanguage.define(await mode())));
}

/**
 * 语言表。顺序即 `matchFilename` 的优先级：
 * 先比 filename 正则（如 Dockerfile），再比扩展名，命中第一个即返回。
 * `load` 只在真正用到该语言时才执行，没打开过的语言不占内存。
 */
const ENTRIES: readonly Entry[] = [
  lezer("json", "JSON", { alias: ["jsonc"], extensions: ["json", "jsonc", "map", "geojson", "webmanifest"] }, async () =>
    (await import("@codemirror/lang-json")).json(),
  ),
  entry(
    "yaml",
    "YAML",
    { alias: ["yml"], extensions: ["yaml", "yml"] },
    async () => (await import("@codemirror/lang-yaml")).yaml(),
    // lang-yaml 的缩进依赖已成的块结构，从零手写时按回车不缩进，见 yamlIndent.ts
    yamlIndentFallback,
  ),
  lezer("markdown", "Markdown", { alias: ["md"], extensions: ["md", "markdown"] }, async () =>
    (await import("@codemirror/lang-markdown")).markdown(),
  ),
  lezer("html", "HTML", { alias: ["htm"], extensions: ["html", "htm", "xhtml"] }, async () =>
    (await import("@codemirror/lang-html")).html(),
  ),
  lezer("css", "CSS", { alias: ["scss", "less"], extensions: ["css", "scss", "less"] }, async () =>
    (await import("@codemirror/lang-css")).css(),
  ),
  lezer(
    "xml",
    "XML",
    {
      alias: ["svg"],
      extensions: ["xml", "svg", "xsd", "xsl", "xslt", "plist", "csproj", "resx"],
    },
    async () => (await import("@codemirror/lang-xml")).xml(),
  ),
  lezer("sql", "SQL", { extensions: ["sql"] }, async () => (await import("@codemirror/lang-sql")).sql()),
  lezer("javascript", "JavaScript", { alias: ["js", "node"], extensions: ["js", "mjs", "cjs"] }, async () =>
    (await import("@codemirror/lang-javascript")).javascript(),
  ),
  lezer("jsx", "JSX", { alias: ["react"], extensions: ["jsx"] }, async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  ),
  lezer("typescript", "TypeScript", { alias: ["ts"], extensions: ["ts", "mts", "cts"] }, async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  ),
  lezer("tsx", "TSX", { extensions: ["tsx"] }, async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  ),
  lezer("python", "Python", { alias: ["py"], extensions: ["py", "pyw", "pyi"] }, async () =>
    (await import("@codemirror/lang-python")).python(),
  ),
  lezer(
    "cpp",
    "C / C++",
    { alias: ["c", "c++", "cpp"], extensions: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx"] },
    async () => (await import("@codemirror/lang-cpp")).cpp(),
  ),
  lezer("rust", "Rust", { alias: ["rs"], extensions: ["rs"] }, async () =>
    (await import("@codemirror/lang-rust")).rust(),
  ),
  lezer("go", "Go", { alias: ["golang"], extensions: ["go"] }, async () =>
    (await import("@codemirror/lang-go")).go(),
  ),
  lezer("java", "Java", { extensions: ["java"] }, async () => (await import("@codemirror/lang-java")).java()),

  stream(
    "powershell",
    "PowerShell",
    { alias: ["ps1"], extensions: ["ps1", "psm1", "psd1"] },
    async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell,
  ),
  stream(
    "shell",
    "Shell",
    { alias: ["bash", "sh"], extensions: ["sh", "bash", "zsh", "ksh"] },
    async () => (await import("@codemirror/legacy-modes/mode/shell")).shell,
  ),
  stream("toml", "TOML", { extensions: ["toml"] }, async () =>
    (await import("@codemirror/legacy-modes/mode/toml")).toml,
  ),
  stream(
    "ini",
    "INI / Properties",
    { alias: ["ini", "properties"], extensions: ["ini", "properties", "cfg", "conf", "env", "editorconfig"] },
    async () => (await import("@codemirror/legacy-modes/mode/properties")).properties,
  ),
  stream(
    "dockerfile",
    "Dockerfile",
    { filename: /^dockerfile(\..+)?$/i, extensions: ["dockerfile"] },
    async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile,
  ),
  stream("lua", "Lua", { extensions: ["lua"] }, async () =>
    (await import("@codemirror/legacy-modes/mode/lua")).lua,
  ),
  stream(
    "ruby",
    "Ruby",
    { alias: ["rb"], extensions: ["rb", "gemspec", "rake"], filename: /^(rakefile|gemfile)$/i },
    async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby,
  ),
  stream("perl", "Perl", { extensions: ["pl", "pm"] }, async () =>
    (await import("@codemirror/legacy-modes/mode/perl")).perl,
  ),
  stream("r", "R", { extensions: ["r", "rmd"] }, async () =>
    (await import("@codemirror/legacy-modes/mode/r")).r,
  ),
];

const DESCS: readonly LanguageDescription[] = ENTRIES.map((e) => e.desc);
const BY_ID = new Map<LanguageId, Entry>(ENTRIES.map((e) => [e.id, e]));

/** 语言显示名（不需要加载语法包，直接来自语言表） */
export function languageLabel(id: LanguageId): string {
  if (id === "text") return "纯文本";
  return BY_ID.get(id)?.desc.name ?? "纯文本";
}

/** 该 id 是否真的在语言表里（用于校验 settings 里存下来的选择） */
export function isKnownLanguageId(value: string): value is LanguageId {
  return value === "text" || BY_ID.has(value as LanguageId);
}

/**
 * 供「手动选择语言」的下拉使用。顺序即语言表顺序（JSON / YAML 在最前，
 * 它们是这个应用的主要格式），纯文本排第一。
 */
export function listLanguages(): readonly { id: LanguageId; label: string }[] {
  return [
    { id: "text", label: languageLabel("text") },
    ...ENTRIES.map((entry) => ({ id: entry.id, label: entry.desc.name })),
  ];
}

/**
 * 依文件名推断语言。
 * `matchFilename` 先比 filename 正则、再比扩展名，且扩展名比较是大小写敏感的，
 * 所以原文（供 Dockerfile 这类正则）与小写（供扩展名，如 `.PY`）各试一次。
 * 认不出来返回 null，交由内容嗅探处理。
 */
export function languageIdFromPath(path: string): LanguageId | null {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  if (base.length === 0) return null;

  const lower = base.toLowerCase();
  const candidates = lower === base ? [base] : [base, lower];
  for (const candidate of candidates) {
    const desc = LanguageDescription.matchFilename(DESCS, candidate);
    if (desc === null) continue;
    const hit = ENTRIES.find((e) => e.desc === desc);
    if (hit !== undefined) return hit.id;
  }
  return null;
}

/**
 * 按内容嗅探语言，只用于没有文件名依据的临时标签。
 * 顺序：先试**代码特征**（Go / Python / Rust / JS 家族…… 见 services/sniff.ts），
 * 特征认不出来再回落到 JSON / YAML 嗅探；都认不出就是纯文本。
 *
 * 代码特征排在前面是因为 `detectFormat` 会把 `def f():` 这种片段当成 YAML
 * （它确实是合法的 YAML 映射键），而那个判断对「粘贴一段代码」的场景是错的。
 */
export function sniffLanguageId(content: string): LanguageId {
  const bySignature = sniffBySignature(content);
  if (bySignature !== null) return bySignature;
  const format: DocFormat = detectFormat(content);
  return format;
}

/** 已加载语言的扩展缓存：同一语言只解析一次语法包 */
const loaded = new Map<LanguageId, Extension>();

/**
 * 取语言的 CodeMirror 扩展。
 * text 返回空扩展；其余按需动态导入并缓存。
 * 加载失败时由调用方降级成纯文本（例如安装包缺文件）。
 */
export async function loadLanguageExtension(id: LanguageId): Promise<Extension> {
  if (id === "text") return [];
  const cached = loaded.get(id);
  if (cached !== undefined) return cached;

  const target = BY_ID.get(id);
  if (target === undefined) return [];

  const support = await target.desc.load();
  const result: Extension = target.extra === undefined ? support : [support, target.extra];

  // 并发加载同一语言时后到者复用先到者的结果，避免覆盖
  const raced = loaded.get(id);
  if (raced !== undefined) return raced;
  loaded.set(id, result);
  return result;
}
