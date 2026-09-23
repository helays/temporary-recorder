import { useEffect, useRef } from "react";
import { editorManager } from "../../extensions/editorManager";
import { useTabsStore } from "../../stores/tabsStore";

export function Editor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeTabId = useTabsStore((state) => state.activeTabId);

  // 挂载 EditorView。整个应用只复用一个 view，切换标签走 setState。
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    editorManager.attach(container);
    return () => {
      editorManager.detach();
    };
  }, []);

  useEffect(() => {
    if (activeTabId !== null) void editorManager.activate(activeTabId);
  }, [activeTabId]);

  return <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />;
}
