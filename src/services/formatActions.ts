import { editorManager } from "../extensions/editorManager";
import { useStatusStore } from "../stores/statusStore";
import {
  detectFormat,
  formatJson,
  formatYaml,
  looksLikeYaml,
  minifyJson,
} from "./format";
import type { FormatResult } from "../types/models";

/** 把格式化失败的位置与原因交给状态栏，而不是弹窗打断 */
function reportFailure(result: Extract<FormatResult, { ok: false }>): void {
  useStatusStore.getState().setMessage({
    kind: "error",
    text: result.message,
    line: result.line,
    column: result.column,
  });
}

/** 格式化当前标签内容（按探测到的格式走 JSON 或 YAML） */
export function formatActiveTab(): void {
  const content = editorManager.getActiveContent();
  if (content === null) return;
  const status = useStatusStore.getState();
  const format = detectFormat(content);

  let result: FormatResult | null = null;
  if (format === "json") {
    result = formatJson(content);
  } else if (format === "yaml") {
    result = formatYaml(content);
  } else if (looksLikeYaml(content)) {
    // 像 YAML 但不是合法对象/数组：让 YAML 解析器给出准确的行列
    result = formatYaml(content);
  }

  if (result === null) {
    status.setMessage({
      kind: "error",
      text: "无法识别内容格式：既不是合法 JSON，也不是 YAML 对象或数组",
    });
    return;
  }

  if (!result.ok) {
    reportFailure(result);
    return;
  }

  if (!result.changed) {
    status.setMessage({ kind: "info", text: "内容已是规范格式，无需改动" });
    return;
  }

  editorManager.replaceActiveContent(result.value);
  status.setMessage({
    kind: "info",
    text: format === "yaml" ? "已格式化 YAML" : "已格式化 JSON",
  });
}

/** 压缩当前标签内容（仅 JSON） */
export function minifyActiveTab(): void {
  const content = editorManager.getActiveContent();
  if (content === null) return;
  const status = useStatusStore.getState();

  if (detectFormat(content) !== "json") {
    status.setMessage({ kind: "error", text: "压缩仅支持 JSON 内容" });
    return;
  }

  const result = minifyJson(content);
  if (!result.ok) {
    reportFailure(result);
    return;
  }

  if (!result.changed) {
    status.setMessage({ kind: "info", text: "内容已是压缩形式，无需改动" });
    return;
  }

  editorManager.replaceActiveContent(result.value);
  status.setMessage({ kind: "info", text: "已压缩 JSON" });
}
