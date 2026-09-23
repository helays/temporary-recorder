import { editorManager } from "../extensions/editorManager";
import { useStatusStore, type StatusMessageKind } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import { forceSaveTabContent } from "./contentStore";
import {
  deleteFile,
  pathStatus,
  pickOpenFile,
  pickSaveFile,
  readTextFile,
  writeTextFile,
  type TextFilePayload,
} from "./fileService";
import { titleFromPath } from "./tempFiles";

/** 超过此大小拒绝打开：整文件读进内存会卡死（5MB 以上本来就会关掉语法高亮） */
const MAX_OPEN_SIZE = 20 * 1024 * 1024;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type OpenOutcome = "opened" | "activated" | "failed" | "skipped";

export interface OpenPathResult {
  outcome: OpenOutcome;
  /** 失败或跳过时的原因，供批量打开汇总 */
  message?: string;
}

function tooLargeMessage(size: number): string {
  const mb = Math.max(1, Math.round(size / 1024 / 1024));
  return `文件过大（${mb} MB），暂不支持打开`;
}

/**
 * 把已知路径打开到新标签，不弹对话框。
 * 快捷键、菜单、拖拽三条入口都走这里。
 * 若该文件已经在某个标签里打开，直接切过去，不重复打开。
 */
export async function openPathIntoNewTab(path: string): Promise<OpenPathResult> {
  const store = useTabsStore.getState();
  const existing = store.tabs.find(
    (tab) => tab.file_path !== null && tab.file_path.toLowerCase() === path.toLowerCase(),
  );
  if (existing !== undefined) {
    await store.activateTab(existing.id);
    return { outcome: "activated", message: `该文件已打开：${path}` };
  }

  // 先问类型和大小，避免把几百 MB 的文件整个读进内存之后才拒绝
  try {
    const status = await pathStatus(path);
    if (!status.exists) return { outcome: "failed", message: `文件不存在：${path}` };
    if (status.is_dir) return { outcome: "skipped", message: `已跳过目录：${path}` };
    if (status.size > MAX_OPEN_SIZE) {
      return { outcome: "failed", message: tooLargeMessage(status.size) };
    }
  } catch (err) {
    return { outcome: "failed", message: `无法访问（${path}）：${describeError(err)}` };
  }

  let payload: TextFilePayload;
  try {
    payload = await readTextFile(path);
  } catch (err) {
    return { outcome: "failed", message: `打开失败（${path}）：${describeError(err)}` };
  }
  // 读的这一步拿到的体积可能更大（文件在两行之间被写大）
  if (payload.size > MAX_OPEN_SIZE) {
    return { outcome: "failed", message: tooLargeMessage(payload.size) };
  }

  const title = await titleFromPath(path);
  await useTabsStore.getState().addFileTab(path, title, payload.content, payload.mtime_ms);
  return { outcome: "opened" };
}

/** Ctrl+O /「文件 ▸ 打开…」：弹对话框选一个文件 */
export async function openFileIntoNewTab(): Promise<void> {
  const path = await pickOpenFile();
  if (path === null) return;
  const result = await openPathIntoNewTab(path);
  if (result.outcome === "opened") {
    useStatusStore.getState().setMessage({ kind: "info", text: `已打开：${path}` });
  } else if (result.message !== undefined) {
    useStatusStore.getState().setMessage({ kind: "error", text: result.message });
  }
}

/** 会话里那个「首次启动自动创建」的空白临时标签 */
interface PristineTab {
  id: string;
  filePath: string | null;
}

/**
 * 找出启动时自动创建、还没被用过的空白标签。
 * 只有整个会话就这一个标签、它是临时标签、内容仍是空的时候才认定——
 * 绝不回收用户自己开的标签。
 */
function findPristineTempTab(): PristineTab | null {
  const { tabs, activeTabId } = useTabsStore.getState();
  if (tabs.length !== 1) return null;
  const only = tabs[0];
  if (only.is_temp !== 1 || only.id !== activeTabId) return null;
  // 内容取不到（编辑器还没建立状态）时按「不敢动」处理
  if ((editorManager.getActiveContent() ?? "\u0000") !== "") return null;
  return { id: only.id, filePath: only.file_path };
}

/**
 * 批量打开（拖拽、多选）。
 * 单个文件成功时不打扰用户；有失败时保留第一条具体原因，
 * 免得状态栏上只剩一个数字、看不出到底哪儿出了问题。
 */
export async function openPathsIntoNewTab(paths: string[]): Promise<void> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push(path);
  }
  if (unique.length === 0) return;

  // 拖入文件时，首次启动留下的那个空白「未命名 1」不该继续占着位置
  const pristine = findPristineTempTab();

  let opened = 0;
  let activated = 0;
  let failed = 0;
  let skipped = 0;
  let firstOpenedId: string | null = null;
  let firstProblem: string | null = null;

  for (const path of unique) {
    const result = await openPathIntoNewTab(path);
    switch (result.outcome) {
      case "opened":
        opened += 1;
        if (firstOpenedId === null) firstOpenedId = useTabsStore.getState().activeTabId;
        break;
      case "activated":
        activated += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
      default:
        failed += 1;
    }
    if (result.outcome !== "opened" && result.outcome !== "activated") {
      if (firstProblem === null && result.message !== undefined) firstProblem = result.message;
    }
  }

  if (pristine !== null && opened > 0) {
    await useTabsStore.getState().closeTab(pristine.id);
    if (pristine.filePath !== null) {
      try {
        await deleteFile(pristine.filePath);
      } catch (err) {
        console.error("[file] 清理空白标签的临时文件失败:", pristine.filePath, err);
      }
    }
  }

  // 一次拖入多个时停在第一个上，位置可预期
  if (opened > 1 && firstOpenedId !== null) {
    await useTabsStore.getState().activateTab(firstOpenedId);
  }

  const success = opened + activated;
  const bad = failed + skipped;
  let kind: StatusMessageKind = "info";
  let text: string;
  if (bad === 0) {
    if (unique.length === 1) {
      text = activated === 1 ? `该文件已打开：${unique[0]}` : `已打开：${unique[0]}`;
    } else {
      text = `已打开 ${success} 个文件`;
    }
  } else {
    kind = "error";
    if (success > 0) {
      text = `已打开 ${success} 个文件，${bad} 个未能打开：${firstProblem ?? "原因未知"}`;
    } else if (unique.length === 1 && firstProblem !== null) {
      text = firstProblem;
    } else {
      text = `${bad} 个文件未能打开：${firstProblem ?? "原因未知"}`;
    }
  }
  useStatusStore.getState().setMessage({ kind, text });
}

/**
 * 保存当前标签。
 * 临时标签还没落到真实文件上，所以走「另存为」；真实文件直接强制写盘。
 */
export async function saveActiveTab(): Promise<void> {
  const store = useTabsStore.getState();
  const tabId = store.activeTabId;
  if (tabId === null) return;
  const tab = store.tabs.find((item) => item.id === tabId);
  if (tab === undefined) return;

  if (tab.is_temp === 1 || tab.file_path === null) {
    await saveActiveTabAs();
    return;
  }

  const content = editorManager.getActiveContent() ?? "";
  const outcome = await forceSaveTabContent(tabId, content);
  if (outcome === "written") {
    useStatusStore.getState().setMessage({ kind: "info", text: `已保存：${tab.file_path}` });
  }
}

/**
 * 另存为：写到用户选定的路径，把标签重新绑定到该文件，
 * 并按约定删除原来的临时文件（临时文件只在「还没另存为」的阶段有用）。
 */
export async function saveActiveTabAs(): Promise<void> {
  const store = useTabsStore.getState();
  const tabId = store.activeTabId;
  if (tabId === null) return;
  const tab = store.tabs.find((item) => item.id === tabId);
  if (tab === undefined) return;

  const content = editorManager.getActiveContent() ?? "";
  const defaultPath = tab.is_temp === 1 ? undefined : (tab.file_path ?? undefined);
  const target = await pickSaveFile(defaultPath);
  if (target === null) return;

  const previousPath = tab.file_path;
  const wasTemp = tab.is_temp === 1;

  try {
    const mtime = await writeTextFile(target, content);
    const title = await titleFromPath(target);
    await store.bindTabFile(tabId, target, false, mtime);
    await store.renameTab(tabId, title);

    if (wasTemp && previousPath !== null && previousPath !== target) {
      try {
        await deleteFile(previousPath);
      } catch (err) {
        // 删不掉不算失败：文件已写到新位置，旧临时文件留待手动清理
        console.error("[file] 删除旧临时文件失败:", previousPath, err);
      }
    }

    useStatusStore.getState().setMessage({ kind: "info", text: `已另存为：${target}` });
  } catch (err) {
    useStatusStore.getState().setMessage({
      kind: "error",
      text: `另存为失败（${target}）：${describeError(err)}`,
    });
  }
}
