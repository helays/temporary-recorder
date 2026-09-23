import { formatActiveTab, minifyActiveTab } from "../../services/formatActions";
import { useStatusStore } from "../../stores/statusStore";
import type { DocFormat } from "../../types/models";

const FORMAT_LABEL: Record<DocFormat, string> = {
  json: "JSON",
  yaml: "YAML",
  text: "纯文本",
};

export function StatusBar() {
  const cursorLine = useStatusStore((state) => state.cursorLine);
  const cursorColumn = useStatusStore((state) => state.cursorColumn);
  const selectionLength = useStatusStore((state) => state.selectionLength);
  const docLength = useStatusStore((state) => state.docLength);
  const format = useStatusStore((state) => state.format);
  const largeFile = useStatusStore((state) => state.largeFile);
  const message = useStatusStore((state) => state.message);
  const setMessage = useStatusStore((state) => state.setMessage);

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-neutral-700 bg-neutral-950 px-2 text-[11px] text-neutral-400">
      <span className="shrink-0 tabular-nums">
        行 {cursorLine}，列 {cursorColumn}
      </span>
      {selectionLength > 0 && (
        <span className="shrink-0 tabular-nums text-neutral-300">已选 {selectionLength}</span>
      )}
      <span className="shrink-0 tabular-nums">共 {docLength} 字符</span>
      <span className="shrink-0 rounded-sm bg-neutral-800 px-1 text-neutral-300">
        {FORMAT_LABEL[format]}
      </span>
      {largeFile && (
        <span className="shrink-0 text-amber-400">已关闭语法高亮（内容过大）</span>
      )}

      <div className="min-w-0 flex-1 truncate">
        {message !== null && (
          <span
            className={message.kind === "error" ? "text-red-400" : "text-neutral-300"}
            title={message.text}
          >
            {message.line !== undefined && message.column !== undefined
              ? `第 ${message.line} 行 第 ${message.column} 列：`
              : ""}
            {message.text}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          title="格式化 (Shift+Alt+F)"
          onClick={formatActiveTab}
          className="rounded-sm px-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          格式化
        </button>
        <button
          type="button"
          title="压缩 JSON (Shift+Alt+M)"
          onClick={minifyActiveTab}
          className="rounded-sm px-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          压缩
        </button>
        {message !== null && (
          <button
            type="button"
            title="清除提示"
            onClick={() => setMessage(null)}
            className="rounded-sm px-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
