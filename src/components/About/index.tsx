import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { useEffect, useState } from "react";
import logo from "../../../src-tauri/icons/128x128.png";

interface AboutProps {
  onClose: () => void;
}

/**
 * 「关于」弹窗。
 * 原生菜单栏在时这里用的是 Tauri 的原生 About 菜单项（系统消息框）；
 * 换成自绘菜单后没有原生项了，改为自绘，顺便把数据目录也显示出来。
 */
export function About({ onClose }: AboutProps) {
  const [version, setVersion] = useState("");
  const [dataDir, setDataDir] = useState("");

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("未知"));
    void appDataDir()
      .then(setDataDir)
      .catch(() => setDataDir(""));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="w-[380px] overflow-hidden rounded-lg border border-app-border bg-app-panel text-app-fg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-5">
          <img src={logo} alt="闪记" className="h-10 w-10" draggable={false} />
          <div>
            <div className="text-base font-medium">闪记</div>
            <div className="text-xs text-app-muted">版本 {version.length > 0 ? version : "…"}</div>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4 text-xs">
          <div className="text-app-muted">
            轻量级临时记录器：快速打开、随手记录、随时关闭。
          </div>
          {dataDir.length > 0 && (
            <div className="space-y-1">
              <div className="text-app-muted">数据目录</div>
              <div className="rounded-sm border border-app-border bg-app-bg px-2 py-1 font-mono break-all">
                {dataDir}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-app-border px-4 py-2">
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
