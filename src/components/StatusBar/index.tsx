import { formatActiveTab, minifyActiveTab } from "../../services/formatActions";
import { LanguagePicker } from "./LanguagePicker";
import { useStatusStore } from "../../stores/statusStore";

export function StatusBar() {
  const cursorLine = useStatusStore((state) => state.cursorLine);
  const cursorColumn = useStatusStore((state) => state.cursorColumn);
  const selectionLength = useStatusStore((state) => state.selectionLength);
  const docLength = useStatusStore((state) => state.docLength);
  const largeFile = useStatusStore((state) => state.largeFile);
  const message = useStatusStore((state) => state.message);
  const setMessage = useStatusStore((state) => state.setMessage);

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-app-border bg-app-panel px-2 text-[11px] text-app-muted">
      <span className="shrink-0 tabular-nums">
        行 {cursorLine}，列 {cursorColumn}
      </span>
      {selectionLength > 0 && (
        <span className="shrink-0 tabular-nums text-app-fg">已选 {selectionLength}</span>
      )}
      <span className="shrink-0 tabular-nums">共 {docLength} 字符</span>
      <LanguagePicker />
      {largeFile && (
        <span className="shrink-0 text-app-warn">已关闭语法高亮（内容过大）</span>
      )}

      <div className="min-w-0 flex-1 truncate">
        {message !== null && (
          <span
            className={message.kind === "error" ? "text-app-danger" : "text-app-fg"}
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
          className="rounded-sm px-1.5 text-app-muted hover:bg-app-hover hover:text-app-fg"
        >
          格式化
        </button>
        <button
          type="button"
          title="压缩 JSON (Shift+Alt+M)"
          onClick={minifyActiveTab}
          className="rounded-sm px-1.5 text-app-muted hover:bg-app-hover hover:text-app-fg"
        >
          压缩
        </button>
        {message !== null && (
          <button
            type="button"
            title="清除提示"
            onClick={() => setMessage(null)}
            className="rounded-sm px-1 text-app-muted hover:bg-app-hover hover:text-app-fg"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
