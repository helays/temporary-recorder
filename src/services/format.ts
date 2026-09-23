import { dump, loadAll, YAMLException } from "js-yaml";
import { findJsonErrorOffset, offsetToLineColumn } from "../utils/jsonError";
import type { DocFormat, FormatResult } from "../types/models";

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * 从 JSON.parse 的错误信息里提取错误位置。
 * V8 有三种表现，按可靠性依次尝试：
 *   1. "(line X column Y)" —— 直接可用
 *   2. "at position N"     —— 按源码换算行列
 *   3. 只给出错片段（新版对 "Unexpected token" 的处理）—— 用自带定位器补上位置
 */
function locateJsonError(
  message: string,
  source: string,
): { line?: number; column?: number; text: string } {
  const lineColumn = /\(line (\d+) column (\d+)\)/i.exec(message);
  if (lineColumn !== null) {
    return {
      line: Number(lineColumn[1]),
      column: Number(lineColumn[2]),
      text: message.replace(/\s*\(line \d+ column \d+\)\s*/i, " ").trim(),
    };
  }

  const position = /at position (\d+)/i.exec(message);
  if (position !== null) {
    const at = offsetToLineColumn(source, Number(position[1]));
    return {
      line: at.line,
      column: at.column,
      text: message.replace(/\s*at position \d+\s*/i, " ").trim(),
    };
  }

  const offset = findJsonErrorOffset(source);
  if (offset >= 0) {
    const at = offsetToLineColumn(source, offset);
    return { line: at.line, column: at.column, text: message };
  }

  return { text: message };
}

function parseJson(source: string): { ok: true; value: unknown } | FormatResult {
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const located = locateJsonError(message, source);
    return {
      ok: false,
      message: located.text.length > 0 ? located.text : "JSON 解析失败",
      line: located.line,
      column: located.column,
    };
  }
}

/** JSON 格式化：标准 2 空格缩进 */
export function formatJson(source: string): FormatResult {
  if (isBlank(source)) return { ok: true, value: source, changed: false };
  const parsed = parseJson(source);
  if (!parsed.ok) return parsed;
  const value = JSON.stringify(parsed.value, null, 2);
  return { ok: true, value, changed: value !== source };
}

/** JSON 压缩：去掉所有非必要空白 */
export function minifyJson(source: string): FormatResult {
  if (isBlank(source)) return { ok: true, value: source, changed: false };
  const parsed = parseJson(source);
  if (!parsed.ok) return parsed;
  const value = JSON.stringify(parsed.value);
  return { ok: true, value, changed: value !== source };
}

interface YamlParse {
  value: unknown;
  documentCount: number;
}

function parseYaml(source: string): YamlParse | FormatResult {
  try {
    // 用 loadAll 而不是 load：v5 的 load() 遇到空文档/多文档会直接抛异常，
    // 这里需要区分「空」「多文档」「语法错误」三种情况。
    const documents = loadAll(source);
    return { value: documents.length > 0 ? documents[0] : undefined, documentCount: documents.length };
  } catch (err) {
    if (err instanceof YAMLException) {
      const mark = err.mark;
      return {
        ok: false,
        message: err.reason,
        line: mark === undefined ? undefined : mark.line + 1,
        column: mark === undefined ? undefined : mark.column + 1,
      };
    }
    // js-yaml 文档明确要求：所有异常都必须捕获，不能只捕获 YAMLException
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * YAML 格式化。
 * lineWidth: -1 关闭按宽度折行，避免长字符串被重排成难以预期的结果；
 * noRefs: true 内联重复对象，避免生成 &ref_0 / *ref_0 锚点。
 */
export function formatYaml(source: string): FormatResult {
  if (isBlank(source)) return { ok: true, value: source, changed: false };

  const parsed = parseYaml(source);
  if ("ok" in parsed && parsed.ok === false) return parsed;
  if (!("documentCount" in parsed)) return parsed;

  if (parsed.documentCount === 0) {
    return { ok: true, value: source, changed: false };
  }
  if (parsed.documentCount > 1) {
    return { ok: false, message: "暂不支持多文档 YAML（存在多个 --- 分隔符）" };
  }

  try {
    const value = dump(parsed.value, { indent: 2, lineWidth: -1, noRefs: true });
    return { ok: true, value, changed: value !== source };
  } catch (err) {
    return {
      ok: false,
      message: `YAML 生成失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 推断内容格式。
 * 顺序很关键：先试 JSON（判定可靠）；以 { 或 [ 开头但解析失败时仍按 JSON 处理，
 * 否则会被 YAML 的宽松语法接走，把语法错误悄悄吞掉。
 * 只有解析成对象 / 数组才认作 YAML —— 任意纯文本都能被 YAML 解析成字符串标量。
 */
export function detectFormat(source: string): DocFormat {
  const trimmed = source.trim();
  if (trimmed.length === 0) return "text";

  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    // 继续尝试 YAML
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";

  try {
    const documents = loadAll(trimmed);
    if (documents.length === 1) {
      const value = documents[0];
      if (value !== null && typeof value === "object") return "yaml";
    }
  } catch {
    // 不是 YAML
  }

  return "text";
}

/**
 * 依文件扩展名判定格式。
 * 打开文件时用它把语言立刻装上——比按内容探测更快，
 * 也避免了「刚打开就按回车却不缩进」。
 * 认不出的扩展名返回 null，交由内容探测处理。
 */
export function formatFromPath(path: string): DocFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  return null;
}

/**
 * 粗略判断内容是否「像 YAML」。
 * 用于内容不合法时也能把 YAML 的语法错误与位置报到状态栏，
 * 而不是笼统地回一句「无法识别格式」。
 */
export function looksLikeYaml(source: string): boolean {
  return /^[ \t]*(?:-[ \t]|[^\s#][^:\n]*:(\s|$))/m.test(source);
}
