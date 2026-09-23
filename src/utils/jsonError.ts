/**
 * 定位 JSON 文本中第一个语法错误的字符偏移量。
 *
 * 为什么需要它：新版 V8 对 "Unexpected token" 一类错误只给出出错片段
 * （例如 `Unexpected token ',', ..."片段"... is not valid JSON`），
 * 不再提供 position / line / column —— 而这一类恰好是最常见的 JSON 笔误。
 * 官方文档要求「显示错误位置和原因」，所以这里自行定位。
 *
 * 本函数只做结构校验、不构造任何值，且只在 JSON.parse 已经失败之后调用，
 * 因此不计入正常路径的性能开销。
 *
 * 返回第一个出错字符的偏移量；返回 -1 表示未发现语法错误（或无法定位）。
 * 本文件刻意不引入任何 import，以便测试脚本直接用 node 运行。
 */
export function findJsonErrorOffset(source: string): number {
  let i = 0;
  const end = source.length;

  const skipWs = (): void => {
    while (i < end) {
      const c = source.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  };

  const isDigit = (): boolean => {
    const c = source.charCodeAt(i);
    return c >= 0x30 && c <= 0x39;
  };

  const parseString = (): boolean => {
    i += 1; // 开引号
    while (i < end) {
      const c = source.charCodeAt(i);
      if (c === 0x22) {
        i += 1;
        return true;
      }
      if (c === 0x5c) {
        i += 1; // 反斜杠
        if (i >= end) return false;
        const esc = source[i];
        if (esc === "u") {
          i += 1;
          for (let k = 0; k < 4; k += 1) {
            const h = source.charCodeAt(i);
            const isHex =
              (h >= 0x30 && h <= 0x39) ||
              (h >= 0x41 && h <= 0x46) ||
              (h >= 0x61 && h <= 0x66);
            if (!isHex) return false;
            i += 1;
          }
        } else if ('"\\/bfnrt'.includes(esc)) {
          i += 1;
        } else {
          return false;
        }
      } else if (c < 0x20) {
        // 控制字符必须转义
        return false;
      } else {
        i += 1;
      }
    }
    return false; // 未闭合
  };

  const parseNumber = (): boolean => {
    if (source[i] === "-") i += 1;
    if (source[i] === "0") {
      i += 1;
    } else if (source[i] >= "1" && source[i] <= "9") {
      while (isDigit()) i += 1;
    } else {
      return false;
    }
    if (source[i] === ".") {
      i += 1;
      if (!isDigit()) return false;
      while (isDigit()) i += 1;
    }
    if (source[i] === "e" || source[i] === "E") {
      i += 1;
      if (source[i] === "+" || source[i] === "-") i += 1;
      if (!isDigit()) return false;
      while (isDigit()) i += 1;
    }
    return true;
  };

  const parseValue = (): boolean => {
    skipWs();
    if (i >= end) return false;
    const ch = source[i];
    if (ch === "{") return parseObject();
    if (ch === "[") return parseArray();
    if (ch === '"') return parseString();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return parseNumber();
    if (source.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (source.startsWith("false", i)) {
      i += 5;
      return true;
    }
    if (source.startsWith("null", i)) {
      i += 4;
      return true;
    }
    return false;
  };

  const parseObject = (): boolean => {
    i += 1; // {
    skipWs();
    if (source[i] === "}") {
      i += 1;
      return true;
    }
    for (;;) {
      skipWs();
      if (source[i] !== '"') return false;
      if (!parseString()) return false;
      skipWs();
      if (source[i] !== ":") return false;
      i += 1;
      if (!parseValue()) return false;
      skipWs();
      const ch = source[i];
      if (ch === ",") {
        i += 1;
        continue;
      }
      if (ch === "}") {
        i += 1;
        return true;
      }
      return false;
    }
  };

  const parseArray = (): boolean => {
    i += 1; // [
    skipWs();
    if (source[i] === "]") {
      i += 1;
      return true;
    }
    for (;;) {
      if (!parseValue()) return false;
      skipWs();
      const ch = source[i];
      if (ch === ",") {
        i += 1;
        continue;
      }
      if (ch === "]") {
        i += 1;
        return true;
      }
      return false;
    }
  };

  if (!parseValue()) return Math.min(i, end);
  skipWs();
  // 顶层值之后仍有内容，例如 {"a":1}{"b":2}
  return i >= end ? -1 : i;
}

/** 把字符偏移量换算成 1 基的行号与列号 */
export function offsetToLineColumn(
  source: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lastBreak = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: clamped - (lastBreak + 1) + 1,
  };
}
