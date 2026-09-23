import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 窗口按钮（最小化 / 最大化-还原 / 关闭）。
 *
 * 窗口改成无边框（decorations: false）后系统不再提供这三个按钮，需要自绘。
 * 最大化状态必须靠 isMaximized() + onResized 同步，否则从最大化还原后图标会不对。
 *
 * 图标用内联 SVG 而不是「□ / ❐ / ✕」这类字符：字符的字形与基线依赖字体，
 * 不同机器上大小与位置会飘；SVG 与 Windows 自带按钮的观感也更接近。
 */

const stroke = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
} as const;

function MinimizeIcon() {
  return (
    <svg {...stroke}>
      <path d="M0 5h10" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg {...stroke}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg {...stroke}>
      <path d="M2.5 3.5h7v7h-7z" />
      <path d="M0.5 6.5v-6h6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...stroke}>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  );
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const sync = (): void => {
      void win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {
          // 取不到状态就按「未最大化」显示，不影响按钮本身可用
        });
    };
    sync();

    void win
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("[titlebar] 监听窗口尺寸失败:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const base = "flex w-11 items-center justify-center";

  return (
    <div className="flex shrink-0 items-stretch" data-tauri-drag-region="false">
      <button
        type="button"
        title="最小化"
        onClick={() => void getCurrentWindow().minimize()}
        className={`${base} text-app-muted hover:bg-app-hover hover:text-app-fg`}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        title={maximized ? "向下还原" : "最大化"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
        className={`${base} text-app-muted hover:bg-app-hover hover:text-app-fg`}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        title="关闭 (Alt+F4)"
        onClick={() => void getCurrentWindow().close()}
        className={`${base} text-app-muted hover:bg-app-danger hover:text-white`}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
