import { write } from "./db";
import { clearTabContent, listLegacyContent } from "./tabsRepo";
import { tempFilePath } from "./tempFiles";
import { writeTextFile } from "./fileService";

/**
 * v1 → v2 的内容迁移。
 *
 * v1 的内容存在 `tabs.content` 里；v2 改为以文件为准。
 * 这里把还没有文件的行的内容落到临时目录，然后清空库里的内容回收空间。
 *
 * 逐行处理，**单行失败不影响其它行，也不丢数据**：
 * 失败的行保持 file_path 为空、content 原样保留，读取时会继续以数据库内容为准。
 */
export async function materializeLegacyContent(): Promise<number> {
  const pending = await listLegacyContent();
  if (pending.length === 0) return 0;

  let migrated = 0;
  for (const row of pending) {
    try {
      const path = await tempFilePath(row.title, row.id);
      const mtime = await writeTextFile(path, row.content);
      const ok = await write(
        "迁移内容到文件",
        `UPDATE tabs SET file_path = $1, is_temp = 1, disk_mtime = $2 WHERE id = $3`,
        [path, mtime, row.id],
      );
      if (ok) {
        await clearTabContent(row.id);
        migrated += 1;
      }
    } catch (err) {
      console.error(`[migrate] 标签 ${row.id} 迁移失败，保留数据库内容:`, err);
    }
  }

  if (migrated < pending.length) {
    console.warn(
      `[migrate] ${pending.length - migrated} 个标签未能迁移到文件，仍以数据库内容为准`,
    );
  }
  return migrated;
}
