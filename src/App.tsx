import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Editor } from "./components/Editor";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { editorManager } from "./extensions/editorManager";
import { getDbPath, initDb, setDbErrorHandler } from "./services/db";
import { formatActiveTab, minifyActiveTab } from "./services/formatActions";
import {
  captureWindowGeometry,
  loadTabForEditor,
  restoreSession,
  restoreWindowGeometry,
  startWindowGeometryTracking,
} from "./services/session";
import { writeActiveTab, writeWindowGeometry } from "./services/sessionRepo";
import { updateTabCaret, updateTabContent } from "./services/tabsRepo";
import { useStatusStore } from "./stores/statusStore";
import { useTabsStore } from "./stores/tabsStore";

/**
 * 编辑器 ↔ 状态 ↔ 数据库的接线。
 * 放在模块作用域，保证在任何 React effect 之前就完成配置，
 * 同时让 editorManager 不必反向依赖 store（避免循环引用）。
 */
editorManager.configure({
  loadTab: (tabId) => loadTabForEditor(tabId, useTabsStore.getState().tabs),
  saveContent: (tabId, content) => {
    void updateTabContent(tabId, content, Date.now());
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
    flush: () => {
      editorManager.flushAll();
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

  useEffect(() => {
    let cancelled = false;
    const disposers: Array<() => void> = [];

    const boot = async (): Promise<void> => {
      // 数据库错误只显示在状态栏，不弹窗、不崩溃
      setDbErrorHandler((text) => useStatusStore.getState().setDbError(text));

      await initDb();
      const dbPath = await getDbPath();
      if (dbPath !== null) console.info(`[db] 数据库位置：${dbPath}`);

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
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-900 text-xs text-neutral-500">
        正在恢复上次的标签…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-900 text-neutral-100">
      <TabBar />
      <Editor />
      <StatusBar />
    </div>
  );
}

export default App;
