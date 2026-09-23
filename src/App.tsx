import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Editor } from "./components/Editor";
import { Settings } from "./components/Settings";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { editorManager } from "./extensions/editorManager";
import { getDbPath, initDb, setDbErrorHandler } from "./services/db";
import { formatActiveTab, minifyActiveTab } from "./services/formatActions";
import { materializeLegacyContent } from "./services/legacyMigration";
import { saveTabContent } from "./services/contentStore";
import {
  openFileIntoNewTab,
  saveActiveTab,
  saveActiveTabAs,
} from "./services/fileActions";
import {
  captureWindowGeometry,
  loadTabForEditor,
  restoreSession,
  restoreWindowGeometry,
  startWindowGeometryTracking,
} from "./services/session";
import { writeActiveTab, writeWindowGeometry } from "./services/sessionRepo";
import { getAllSettings } from "./services/settingsRepo";
import { updateTabCaret } from "./services/tabsRepo";
import { applyThemeToDocument, watchSystemTheme } from "./services/theme";
import { resolveTheme, useSettingsStore } from "./stores/settingsStore";
import { useStatusStore } from "./stores/statusStore";
import { useTabsStore } from "./stores/tabsStore";

/**
 * 编辑器 ↔ 状态 ↔ 数据库的接线。
 * 放在模块作用域，保证在任何 React effect 之前就完成配置，
 * 同时让 editorManager 不必反向依赖 store（避免循环引用）。
 */
editorManager.configure({
  loadTab: (tabId) => loadTabForEditor(tabId, useTabsStore.getState().tabs),
  // v2 起内容不再写数据库，而是写到标签背后的文件
  saveContent: (tabId, content) => {
    void saveTabContent(tabId, content);
  },
  saveCaret: (tabId, cursorLine, cursorCh, scrollTop) => {
    void updateTabCaret(tabId, cursorLine, cursorCh, scrollTop);
  },
  onCursor: (info) => {
    useStatusStore
      .getState()
      .setCursor(info.line, info.column, info.selectionLength, info.docLength);
  },
  onLargeFile: (tabId, large) => {
    // 状态栏只反映当前标签
    if (tabId !== useTabsStore.getState().activeTabId) return;
    useStatusStore.getState().setLargeFile(large);
  },
  onFormat: (tabId, format) => {
    if (tabId !== useTabsStore.getState().activeTabId) return;
    useStatusStore.getState().setFormat(format);
  },
  keymapHandlers: {
    newTab: () => {
      void useTabsStore.getState().createTab();
    },
    closeTab: () => {
      const id = useTabsStore.getState().activeTabId;
      if (id !== null) void useTabsStore.getState().closeTab(id);
    },
    nextTab: () => {
      void useTabsStore.getState().cycleTab(1);
    },
    previousTab: () => {
      void useTabsStore.getState().cycleTab(-1);
    },
    switchToIndex: (index) => {
      void useTabsStore.getState().activateIndex(index);
    },
    format: () => {
      formatActiveTab();
    },
    minify: () => {
      minifyActiveTab();
    },
    openFile: () => {
      void openFileIntoNewTab();
    },
    save: () => {
      void saveActiveTab();
    },
    saveAs: () => {
      void saveActiveTabAs();
    },
    openSettings: () => {
      useStatusStore.getState().setSettingsOpen(true);
    },
  },
});

/** 双 rAF 后再显示窗口：确保首帧已经绘制，避免白屏闪烁 */
function showWindowWhenPainted(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void getCurrentWindow().show();
    });
  });
}

/**
 * 安装退出处理：强制写入内容、光标、激活标签与窗口几何。
 * 用 destroy() 结束进程——close() 会再次触发 onCloseRequested 形成循环。
 */
async function installCloseHandler(): Promise<() => void> {
  const win = getCurrentWindow();
  let closing = false;

  return win.onCloseRequested(async (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    try {
      editorManager.flushAll();
      await writeActiveTab(useTabsStore.getState().activeTabId);
      const geometry = await captureWindowGeometry();
      if (geometry !== null) await writeWindowGeometry(geometry);
    } catch (err) {
      console.error("[app] 退出前写入失败:", err);
    } finally {
      await win.destroy();
    }
  });
}

function App() {
  const [ready, setReady] = useState(false);
  const themePref = useSettingsStore((state) => state.themePref);
  const systemTheme = useSettingsStore((state) => state.systemTheme);
  const settingsOpen = useStatusStore((state) => state.settingsOpen);
  const setSettingsOpen = useStatusStore((state) => state.setSettingsOpen);

  // 应用主题到文档与编辑器。窗口在启动完成前是隐藏的，所以这里不会闪。
  useEffect(() => {
    const resolved = resolveTheme(themePref, systemTheme);
    applyThemeToDocument(resolved);
    editorManager.setTheme(resolved);
  }, [themePref, systemTheme]);

  useEffect(() => {
    let cancelled = false;
    const disposers: Array<() => void> = [];

    const boot = async (): Promise<void> => {
      // 数据库错误只显示在状态栏，不弹窗、不崩溃
      setDbErrorHandler((text) => useStatusStore.getState().setDbError(text));

      await initDb();
      const dbPath = await getDbPath();
      if (dbPath !== null) console.info(`[db] 数据库位置：${dbPath}`);

      // 先读设置：主题与临时目录都要在后续步骤之前就位
      const settings = await getAllSettings();
      useSettingsStore.getState().hydrate(settings);

      disposers.push(
        await watchSystemTheme((theme) =>
          useSettingsStore.getState().setSystemTheme(theme),
        ),
      );

      // v1 的内容还在数据库里，先落到临时目录（失败的行保持原样，不丢数据）
      const migrated = await materializeLegacyContent();
      if (migrated > 0) console.info(`[db] 已把 ${migrated} 个标签的内容迁移到文件`);

      const { tabs, activeTabId, session } = await restoreSession();

      // 先恢复窗口几何，再显示，避免先闪一个错误尺寸的窗口
      await restoreWindowGeometry(session);
      if (cancelled) return;

      if (tabs.length === 0) {
        // 首次启动，或数据库被删除后重启：自动创建一个空白标签
        useTabsStore.getState().setInitial([], null);
        await useTabsStore.getState().createTab();
      } else {
        useTabsStore.getState().setInitial(tabs, activeTabId);
      }
      if (cancelled) return;

      disposers.push(await startWindowGeometryTracking());
      disposers.push(await installCloseHandler());

      if (cancelled) {
        disposers.forEach((dispose) => dispose());
        return;
      }
      setReady(true);
    };

    void boot()
      .catch((err: unknown) => {
        console.error("[app] 启动失败:", err);
        useStatusStore.getState().setMessage({
          kind: "error",
          text: `启动异常：${err instanceof Error ? err.message : String(err)}`,
        });
        setReady(true);
      })
      .finally(() => {
        if (!cancelled) showWindowWhenPainted();
      });

    // 兜底：启动流程无论成功失败，3 秒后都让窗口可见，避免永久不可见
    const failsafe = setTimeout(() => {
      void getCurrentWindow().show();
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
      disposers.forEach((dispose) => dispose());
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app-bg text-xs text-app-muted">
        正在恢复上次的标签…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app-bg text-app-fg">
      <TabBar />
      <Editor />
      <StatusBar />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
