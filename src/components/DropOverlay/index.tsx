import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPathsIntoNewTab } from "../../services/fileActions";

/**
 * 文件拖放遮罩。
 *
 * `dragDropEnabled` 默认为 true，所以窗口级拖放由 Tauri 接管
 * （WebView 的 HTML5 DnD 因此被禁用；标签拖拽用的是指针事件，不受影响）。
 *
 * `over` 事件只带坐标且会持续高频触发，所以这里刻意不为它 setState，
 * 只在 enter / leave / drop 时更新，避免一次拖拽打出成百上千次重渲染。
 */
export function DropOverlay() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          setCount(payload.paths.length);
        } else if (payload.type === "leave") {
          setCount(0);
        } else if (payload.type === "drop") {
          setCount(0);
          if (payload.paths.length > 0) void openPathsIntoNewTab(payload.paths);
        }
      })
      .then((fn) => {
        // 卸载早于注册完成时立刻退订，避免监听泄漏
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("[dnd] 注册拖放监听失败:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="rounded-lg border-2 border-dashed border-app-accent bg-app-panel px-8 py-6 text-center shadow-xl">
        <div className="text-sm text-app-accent">松开即可打开 {count} 个文件</div>
      </div>
    </div>
  );
}
