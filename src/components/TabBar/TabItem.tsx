import { useEffect, useRef, useState } from "react";
import type { TabMeta } from "../../types/models";

interface TabItemProps {
  tab: TabMeta;
  active: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function TabItem({ tab, active, onActivate, onClose, onRename }: TabItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(tab.title);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, tab.title]);

  const commit = (): void => {
    onRename(tab.id, draft);
    setEditing(false);
  };

  const cancel = (): void => {
    setDraft(tab.title);
    setEditing(false);
  };

  return (
    <div
      className={`group flex h-[22px] max-w-48 items-center gap-1.5 rounded-full px-2.5 text-xs select-none ${
        active
          ? "bg-app-bg text-app-fg shadow-sm ring-1 ring-app-border"
          : "text-app-muted hover:bg-app-hover hover:text-app-fg"
      }`}
      onMouseDown={(event) => {
        if (editing) return;
        // 用 mousedown 而不是 click：避免与编辑器失焦、拖拽手势互相干扰
        event.preventDefault();
        onActivate(tab.id);
      }}
      onDoubleClick={() => setEditing(true)}
      title={tab.title}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className="h-[18px] w-28 rounded-full border border-app-border bg-app-bg px-1.5 text-xs text-app-fg outline-none"
        />
      ) : (
        <span className="truncate">{tab.title}</span>
      )}

      <button
        type="button"
        title="关闭标签 (Ctrl+W)"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-app-muted hover:bg-app-hover hover:text-app-fg focus:opacity-100 ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        ×
      </button>
    </div>
  );
}
