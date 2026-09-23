import { useEffect, useRef, useState } from "react";
import { HELP_SECTIONS } from "./sections";

interface HelpProps {
  onClose: () => void;
}

/**
 * 「使用说明」弹窗（F1 或 帮助 ▸ 使用说明）。
 *
 * 与「关于」分开：关于讲版本与数据目录，这里讲怎么用。
 * 外壳沿用设置弹窗那套（点遮罩关闭、Esc 关闭、头部 / 可滚动正文 / 底部三带），
 * 左侧是目录，点击滚动到对应小节。
 */
export function Help({ onClose }: HelpProps) {
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const goTo = (id: string): void => {
    setActiveId(id);
    const target = bodyRef.current?.querySelector(`#help-${id}`);
    target?.scrollIntoView({ block: "start" });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[760px] flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel text-app-fg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-app-border px-4 py-2">
          <span className="text-sm font-medium">使用说明</span>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            className="rounded-sm px-2 text-app-muted hover:bg-app-hover hover:text-app-fg"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-40 shrink-0 space-y-0.5 overflow-y-auto border-r border-app-border px-2 py-3 text-xs">
            {HELP_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => goTo(section.id)}
                className={`block w-full rounded-sm px-2 py-1 text-left ${
                  activeId === section.id
                    ? "bg-app-hover text-app-fg"
                    : "text-app-muted hover:bg-app-hover hover:text-app-fg"
                }`}
              >
                {section.title}
              </button>
            ))}
          </nav>

          <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
            {HELP_SECTIONS.map((section) => (
              <section key={section.id} id={`help-${section.id}`} className="space-y-2">
                <h3 className="text-sm font-medium text-app-fg">{section.title}</h3>
                {section.body}
              </section>
            ))}
            <div className="text-[11px] text-app-muted">
              完整说明以仓库里的 README 为准；这份帮助与它手工同步。
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-app-border px-4 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-app-border px-3 py-1 text-xs hover:bg-app-hover"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
