/** 大文件阈值：超过则关闭语法高亮（性能红线） */
export const LARGE_CONTENT_THRESHOLD = 5 * 1024 * 1024;

/**
 * 统一换行符为 LF：CRLF / CR -> LF。
 * 项目约定所有内容一律以 LF 存储，不随系统变化。
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * 是否超出大文件阈值。
 * 用 length（UTF-16 码元数）而非字节数，是 O(1) 的近似判断；
 * 阈值本身就是量级判断，无需精确字节统计。
 */
export function isLargeContent(text: string): boolean {
  return text.length > LARGE_CONTENT_THRESHOLD;
}
