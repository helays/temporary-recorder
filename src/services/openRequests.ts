import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPathsIntoNewTab } from "./fileActions";

/**
 * 命令行入口的接线：把系统交过来的文件变成标签。
 *
 * Rust 侧只在两处产生「待打开文件」（见 src-tauri/src/commands/launch.rs）：
 * · 本进程启动时带的命令行参数 —— 双击文件、右键「打开方式」、把文件拖到 exe 上；
 * · 已在运行的那个实例收到第二个实例转交的参数 —— 单实例插件把 argv 递过来。
 *
 * 两处都只做两件事：把路径放进 Rust 的队列、发一个 `open-paths` 事件。
 * 事件**只是唤醒信号**，路径一律走 take_pending_open_paths 取：
 * 队列是唯一真源，于是「事件早于前端订阅」（被丢掉）与「事件晚于本次取队列」
 * 两种时序都不会丢文件、也不会重复打开（同一路径已在标签里时会切过去）。
 */
const OPEN_EVENT = "open-paths";

/** 取走队列里的待打开路径（取一次少一次） */
export function takePendingOpenPaths(): Promise<string[]> {
  return invoke<string[]>("take_pending_open_paths");
}

let tail: Promise<void> = Promise.resolve();

/**
 * 取队列，并把里面的文件开成标签。
 *
 * 串行化（与 services/db.ts 的 serialize 同一手法）：两次唤醒叠在一起时，
 * 后一次排队等前一次开完——既不会并发读一堆文件，也不会丢掉任何一次唤醒。
 */
function drain(): Promise<void> {
  const run = tail.then(async () => {
    const paths = await takePendingOpenPaths();
    // 复用拖拽/菜单那条打开路径：大小上限、已打开即切过去、
    // 目录跳过、空白标签回收、状态栏汇总全都在里面
    if (paths.length > 0) await openPathsIntoNewTab(paths);
  });
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run.catch((err: unknown) => {
    console.error("[launch] 打开命令行传来的文件失败:", err);
  });
}

/**
 * 订阅「有文件要打开」，并处理一次启动时带的参数。
 *
 * 必须在会话恢复、标签就绪之后再调用：空白标签的回收（fileActions 里的
 * findPristineTempTab）依赖「整个会话只有一个标签」这个前提。
 *
 * 启动那一次是 await 的——等文件开完再让窗口显示，避免先闪一个空标签。
 * 返回退订函数。
 */
export async function startOpenRequestWatcher(): Promise<() => void> {
  const unlisten = await listen(OPEN_EVENT, () => {
    void drain();
  });
  await drain();
  return unlisten;
}
