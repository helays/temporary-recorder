import {
  availableMonitors,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { getTabContent, listTabMeta, updateTabDiskMtime } from "./tabsRepo";
import { readSession, writeWindowGeometry } from "./sessionRepo";
import { readTextFile } from "./fileService";
import { languageIdFromPath } from "./languages";
import { normalizeNewlines } from "../utils/text";
import { debounce } from "../utils/debounce";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import type { SessionRow, TabMeta, WindowGeometry } from "../types/models";
import type { TabContent } from "../extensions/editorManager";

/** 窗口大小/位置变更 500ms 防抖落库 */
const WINDOW_SAVE_DELAY = 500;

export interface RestoreResult {
  tabs: TabMeta[];
  activeTabId: string | null;
  session: SessionRow | null;
}

/**
 * 启动时的会话恢复：读取标签列表、激活标签与窗口状态。
 * 静默完成，不弹窗询问；数据库不可用时返回空结果并照常启动。
 */
export async function restoreSession(): Promise<RestoreResult> {
  const tabs = await listTabMeta();
  const session = await readSession();

  let activeTabId = session?.active_tab_id ?? null;
  // active_tab_id 指向的标签不存在时回退到第一个
  if (activeTabId !== null && !tabs.some((tab) => tab.id === activeTabId)) {
    activeTabId = null;
  }
  if (activeTabId === null && tabs.length > 0) {
    activeTabId = tabs[0].id;
  }
  return { tabs, activeTabId, session };
}

/**
 * 为编辑器载入某标签的初始状态。
 *
 * v2 起内容以文件为准；只有 file_path 为空的行（迁移未完成 / 临时目录不可用）
 * 才退回读数据库内容。文件读不到时也走这条兜底，并在状态栏说明。
 */
export async function loadTabForEditor(
  tabId: string,
  tabs: TabMeta[],
): Promise<TabContent | null> {
  const meta = tabs.find((tab) => tab.id === tabId);
  if (meta === undefined) return null;

  let content: string | null = null;

  if (meta.file_path !== null) {
    try {
      const payload = await readTextFile(meta.file_path);
      content = payload.content;
      // 记下基线 mtime，自动保存时用它检测外部改动
      useTabsStore.getState().setDiskMtime(tabId, payload.mtime_ms);
      void updateTabDiskMtime(tabId, payload.mtime_ms);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[session] 读取标签文件失败，退回数据库内容:", meta.file_path, err);
      useStatusStore.getState().setMessage({
        kind: "error",
        text: `打开文件失败（${meta.file_path}）：${detail}`,
      });
      content = await getTabContent(tabId);
    }
  } else {
    content = await getTabContent(tabId);
  }

  return {
    content: normalizeNewlines(content ?? ""),
    cursorLine: meta.cursor_line,
    cursorCh: meta.cursor_ch,
    scrollTop: meta.scroll_top,
    // 打开的文件按文件名立刻确定语言，换行缩进随即生效
    languageId:
      meta.file_path === null ? undefined : (languageIdFromPath(meta.file_path) ?? undefined),
  };
}

/**
 * 读取当前窗口几何，统一换算成逻辑像素。
 *
 * 尺寸必须用 innerSize()（客户区）——Tauri 的 setSize() 设置的就是客户区尺寸，
 * 而 outerSize() 含标题栏与边框（实测多出 16x39）。两者混用会导致
 * 每次重启窗口都按边框尺寸长大一圈。
 * 位置则与 outerPosition()/setPosition() 配对（都是窗口外框左上角）。
 *
 * 存逻辑像素而非物理像素，DPI 变化（换显示器）后位置才不会错乱。
 */
export async function captureWindowGeometry(): Promise<WindowGeometry | null> {
  try {
    const win = getCurrentWindow();
    const scaleFactor = await win.scaleFactor();
    const size = (await win.innerSize()).toLogical(scaleFactor);
    const position = (await win.outerPosition()).toLogical(scaleFactor);
    return {
      width: Math.round(size.width),
      height: Math.round(size.height),
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
  } catch (err) {
    console.error("[window] 读取窗口几何失败:", err);
    return null;
  }
}

function geometryFromSession(session: SessionRow | null): WindowGeometry | null {
  if (
    session === null ||
    session.window_width === null ||
    session.window_height === null ||
    session.window_x === null ||
    session.window_y === null
  ) {
    return null;
  }
  const geometry: WindowGeometry = {
    width: session.window_width,
    height: session.window_height,
    x: session.window_x,
    y: session.window_y,
  };
  // 拒绝明显不合理的尺寸，避免窗口不可见或不可用
  if (geometry.width < 200 || geometry.height < 150) return null;
  return geometry;
}

/**
 * 判断窗口是否仍落在某个显示器可见区域内。
 * 副屏被拔掉后，历史坐标会指向不存在的区域，此时必须放弃恢复。
 */
async function isGeometryReachable(geometry: WindowGeometry): Promise<boolean> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) return true;
    return monitors.some((monitor) => {
      const origin = monitor.position.toLogical(monitor.scaleFactor);
      const size = monitor.size.toLogical(monitor.scaleFactor);
      // 要求窗口标题栏所在区域可见，保证还能拖得动
      return (
        geometry.x >= origin.x - 8 &&
        geometry.x < origin.x + size.width - 48 &&
        geometry.y >= origin.y - 8 &&
        geometry.y < origin.y + size.height - 48
      );
    });
  } catch (err) {
    console.error("[window] 读取显示器列表失败:", err);
    return true;
  }
}

/**
 * 恢复窗口大小与位置。必须在窗口 show() 之前调用，避免先闪一个错误尺寸。
 * 位置不可达（例如副屏被拔掉）时退回居中。
 */
export async function restoreWindowGeometry(session: SessionRow | null): Promise<void> {
  const win = getCurrentWindow();
  const geometry = geometryFromSession(session);

  if (geometry !== null && (await isGeometryReachable(geometry))) {
    try {
      await win.setSize(new LogicalSize(geometry.width, geometry.height));
      await win.setPosition(new LogicalPosition(geometry.x, geometry.y));
      return;
    } catch (err) {
      console.error("[window] 恢复窗口几何失败，改为居中:", err);
    }
  }

  try {
    await win.center();
  } catch (err) {
    console.error("[window] 窗口居中失败:", err);
  }
}

/**
 * 开始跟踪窗口 resize / move，500ms 防抖后写入 session 表。
 * 返回取消跟踪的函数。
 */
export async function startWindowGeometryTracking(): Promise<() => void> {
  const win = getCurrentWindow();
  const save = debounce(() => {
    void (async () => {
      const geometry = await captureWindowGeometry();
      if (geometry !== null) await writeWindowGeometry(geometry);
    })();
  }, WINDOW_SAVE_DELAY);

  const unlistenResized = await win.onResized(() => save());
  const unlistenMoved = await win.onMoved(() => save());

  return () => {
    save.cancel();
    unlistenResized();
    unlistenMoved();
  };
}
