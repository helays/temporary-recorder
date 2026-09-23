import { confirm } from "@tauri-apps/plugin-dialog";
import { useTabsStore } from "../stores/tabsStore";
import { deleteFile, listDir, type DirEntryInfo } from "./fileService";
import { effectiveTempDir } from "./tempFiles";

export interface TempDirScan {
  dir: string;
  /** 临时目录里的普通文件 */
  files: DirEntryInfo[];
  /** 没有任何标签引用的文件 */
  orphans: DirEntryInfo[];
}

/**
 * 扫描临时目录。
 *
 * 孤儿 = 临时目录里没有任何标签引用的文件。关闭临时标签时我们刻意保留文件，
 * 所以这些通常就是「已关闭标签的草稿」，仍然可以找回。
 */
export async function scanTempDir(): Promise<TempDirScan> {
  const dir = await effectiveTempDir();
  const entries = await listDir(dir);
  const files = entries.filter((entry) => entry.is_file);
  const referenced = new Set(
    useTabsStore
      .getState()
      .tabs.map((tab) => tab.file_path)
      .filter((path): path is string => path !== null)
      .map((path) => path.toLowerCase()),
  );
  return { dir, files, orphans: files.filter((entry) => !referenced.has(entry.path.toLowerCase())) };
}

export interface CleanupResult {
  /** 用户在确认框里选了取消 */
  cancelled: boolean;
  /** 实际删掉的文件数 */
  removed: number;
  /** 本次认定的孤儿文件数 */
  total: number;
}

/**
 * 清理孤儿临时文件（带确认框）。
 * 设置面板与「设置」菜单共用这一条路径，避免两处各写一遍清理逻辑。
 */
export async function cleanOrphanTempFiles(): Promise<CleanupResult> {
  const { orphans } = await scanTempDir();
  if (orphans.length === 0) {
    return { cancelled: false, removed: 0, total: 0 };
  }

  const yes = await confirm(
    `将删除 ${orphans.length} 个没有被任何标签引用的临时文件。\n` +
      `这些多半是已关闭标签留下的草稿，删除后无法找回。确定继续吗？`,
    { title: "清理临时文件", kind: "warning" },
  );
  if (!yes) return { cancelled: true, removed: 0, total: orphans.length };

  let removed = 0;
  for (const entry of orphans) {
    try {
      if (await deleteFile(entry.path)) removed += 1;
    } catch (err) {
      console.error("[temp] 删除临时文件失败:", entry.path, err);
    }
  }
  return { cancelled: false, removed, total: orphans.length };
}

/** 清理结果的一句话描述 */
export function describeCleanup(result: CleanupResult): string {
  if (result.cancelled) return "已取消清理";
  if (result.total === 0) return "没有需要清理的孤儿临时文件";
  return `已清理 ${result.removed} / ${result.total} 个未使用的临时文件`;
}
