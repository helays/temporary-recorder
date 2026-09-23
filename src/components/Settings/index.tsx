import { useCallback, useEffect, useState } from "react";
import { pickDirectory, revealPath, type DirEntryInfo } from "../../services/fileService";
import {
  cleanOrphanTempFiles,
  describeCleanup,
  scanTempDir,
} from "../../services/tempCleanup";
import { defaultTempDir, effectiveTempDir } from "../../services/tempFiles";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTabsStore } from "../../stores/tabsStore";
import type { ThemePref } from "../../types/models";

const THEME_OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const themePref = useSettingsStore((state) => state.themePref);
  const setThemePref = useSettingsStore((state) => state.setThemePref);
  const configuredTempDir = useSettingsStore((state) => state.tempDir);
  const setTempDir = useSettingsStore((state) => state.setTempDir);
  const autoSaveToFile = useSettingsStore((state) => state.autoSaveToFile);
  const setAutoSaveToFile = useSettingsStore((state) => state.setAutoSaveToFile);
  const tabs = useTabsStore((state) => state.tabs);

  const [effectiveDir, setEffectiveDir] = useState("");
  const [defaultDir, setDefaultDir] = useState("");
  const [files, setFiles] = useState<DirEntryInfo[]>([]);
  const [orphans, setOrphans] = useState<DirEntryInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const dir = await effectiveTempDir();
      setEffectiveDir(dir);
      setDefaultDir(await defaultTempDir());

      const entries = await scanTempDir();
      setFiles(entries.files);
      setOrphans(entries.orphans);
    } catch (err) {
      setNotice(`读取临时目录失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [tabs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handlePickDir = async (): Promise<void> => {
    const picked = await pickDirectory(effectiveDir);
    if (picked === null) return;
    setTempDir(picked);
    setNotice("临时目录已更新：新标签将落到该目录（已存在的标签保持原文件）");
  };

  const handleCleanOrphans = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await cleanOrphanTempFiles();
      setNotice(describeCleanup(result));
    } catch (err) {
      setNotice(`清理失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel text-app-fg shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-app-border px-4 py-2">
          <span className="text-sm font-medium">设置</span>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            className="rounded-sm px-2 text-app-muted hover:bg-app-hover hover:text-app-fg"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-xs">
          {/* 主题 */}
          <section className="space-y-2">
            <div className="text-app-muted">主题</div>
            <div className="flex gap-1">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setThemePref(option.value)}
                  className={`rounded-sm border px-3 py-1 ${
                    themePref === option.value
                      ? "border-app-accent text-app-accent"
                      : "border-app-border text-app-muted hover:bg-app-hover"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          {/* 临时目录 */}
          <section className="space-y-2">
            <div className="text-app-muted">临时目录</div>
            <div className="rounded-sm border border-app-border bg-app-bg px-2 py-1 font-mono break-all">
              {effectiveDir || "（读取中…）"}
            </div>
            <div className="text-app-muted">
              新建的标签会在这个目录里建文件；设置「另存为」后会删除对应的临时文件。
              当前临时文件 {files.length} 个，其中未被任何标签引用的 {orphans.length} 个。
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handlePickDir()}
                className="rounded-sm border border-app-border px-2 py-1 hover:bg-app-hover"
              >
                选择目录…
              </button>
              <button
                type="button"
                onClick={() => {
                  setTempDir("");
                  setNotice("已恢复默认临时目录");
                }}
                disabled={configuredTempDir.trim().length === 0}
                className="rounded-sm border border-app-border px-2 py-1 hover:bg-app-hover disabled:opacity-40"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={() => void revealPath(effectiveDir)}
                className="rounded-sm border border-app-border px-2 py-1 hover:bg-app-hover"
              >
                打开目录
              </button>
            </div>
            {configuredTempDir.trim().length === 0 && defaultDir.length > 0 && (
              <div className="text-app-muted">（正在使用默认目录）</div>
            )}
          </section>

          {/* 自动保存 */}
          <section className="space-y-2">
            <div className="text-app-muted">保存行为</div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={autoSaveToFile}
                onChange={(event) => setAutoSaveToFile(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                打开的文件自动保存
                <span className="text-app-muted">
                  （停止输入约 0.8 秒后写回原文件；文件被其他程序改过时会暂停自动保存并提示）
                </span>
              </span>
            </label>
          </section>

          {/* 临时文件清理 */}
          <section className="space-y-2">
            <div className="text-app-muted">临时文件</div>
            <div className="text-app-muted">
              关闭临时标签时不会删除它的文件，方便找回。清理只针对没有任何标签引用的文件。
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCleanOrphans()}
              className="rounded-sm border border-app-border px-2 py-1 hover:bg-app-hover disabled:opacity-40"
            >
              {busy ? "清理中…" : `清理未使用的临时文件（${orphans.length}）`}
            </button>
          </section>

          {notice !== null && <div className="text-app-accent">{notice}</div>}
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
