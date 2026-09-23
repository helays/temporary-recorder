import { read, write } from "./db";
import type { TabMeta, TabRecord } from "../types/models";

/**
 * 列表查询只取元数据字段，绝不 SELECT *。
 * content 可能很大（v1 遗留数据），把全部内容读进内存会拖垮启动与内存指标。
 */
const META_COLUMNS =
  "id, title, sort_order, cursor_line, cursor_ch, scroll_top, created_at, updated_at, file_path, is_temp, disk_mtime";

export function listTabMeta(): Promise<TabMeta[]> {
  return read<TabMeta>(
    "读取标签列表",
    `SELECT ${META_COLUMNS} FROM tabs ORDER BY sort_order ASC, created_at ASC`,
  );
}

/** v1 遗留内容：还没有对应文件的行（迁移用） */
export function listLegacyContent(): Promise<
  Array<{ id: string; title: string; content: string }>
> {
  return read<{ id: string; title: string; content: string }>(
    "列出待迁移内容",
    `SELECT id, title, content FROM tabs WHERE file_path IS NULL AND content <> ''`,
  );
}

/** 兜底读取：仅用于 file_path 为空的行 */
export async function getTabContent(id: string): Promise<string | null> {
  const rows = await read<{ content: string }>(
    "读取标签内容",
    `SELECT content FROM tabs WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? rows[0].content : null;
}

/** 下一个可用的 sort_order（追加到末尾） */
export async function nextSortOrder(): Promise<number> {
  const rows = await read<{ max_order: number | null }>(
    "读取排序号",
    `SELECT MAX(sort_order) AS max_order FROM tabs`,
  );
  const max = rows.length > 0 ? rows[0].max_order : null;
  return max === null ? 0 : max + 1;
}

export function insertTab(tab: TabRecord): Promise<boolean> {
  return write(
    "新建标签",
    `INSERT INTO tabs
       (id, title, content, sort_order, cursor_line, cursor_ch, scroll_top,
        created_at, updated_at, file_path, is_temp, disk_mtime)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      tab.id,
      tab.title,
      tab.content,
      tab.sort_order,
      tab.cursor_line,
      tab.cursor_ch,
      tab.scroll_top,
      tab.created_at,
      tab.updated_at,
      tab.file_path,
      tab.is_temp,
      tab.disk_mtime,
    ],
  );
}

export function updateTabTitle(
  id: string,
  title: string,
  updatedAt: number,
): Promise<boolean> {
  return write("重命名标签", `UPDATE tabs SET title = $1, updated_at = $2 WHERE id = $3`, [
    title,
    updatedAt,
    id,
  ]);
}

/** 绑定内容文件（新建标签、另存为、v1 迁移都走这里） */
export function updateTabFile(
  id: string,
  filePath: string | null,
  isTemp: number,
  diskMtime: number | null,
): Promise<boolean> {
  return write(
    "保存标签文件位置",
    `UPDATE tabs SET file_path = $1, is_temp = $2, disk_mtime = $3, updated_at = $4 WHERE id = $5`,
    [filePath, isTemp, diskMtime, Date.now(), id],
  );
}

/** 只更新 mtime（每次自动写文件后调用） */
export function updateTabDiskMtime(id: string, diskMtime: number): Promise<boolean> {
  return write("更新文件时间戳", `UPDATE tabs SET disk_mtime = $1 WHERE id = $2`, [
    diskMtime,
    id,
  ]);
}

/** 迁移完成后清掉库里的内容，回收空间 */
export function clearTabContent(id: string): Promise<boolean> {
  return write("清理已迁移内容", `UPDATE tabs SET content = '' WHERE id = $1`, [id]);
}

/** 光标与滚动位置（1 秒防抖写入） */
export function updateTabCaret(
  id: string,
  cursorLine: number,
  cursorCh: number,
  scrollTop: number,
): Promise<boolean> {
  return write(
    "保存光标位置",
    `UPDATE tabs SET cursor_line = $1, cursor_ch = $2, scroll_top = $3 WHERE id = $4`,
    [cursorLine, cursorCh, scrollTop, id],
  );
}

export function deleteTab(id: string): Promise<boolean> {
  return write("关闭标签", `DELETE FROM tabs WHERE id = $1`, [id]);
}

/**
 * 批量更新标签顺序。
 * 插件没有事务 API，用单条 CASE 语句一次写完，避免 N 次往返与中间态。
 * 调用方需传入「按目标顺序排列」的 id 数组。
 */
export function updateTabOrder(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return Promise.resolve(true);
  const cases = ids.map((_, index) => `WHEN $${index + 1} THEN ${index}`).join(" ");
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  return write(
    "保存标签顺序",
    `UPDATE tabs SET sort_order = CASE id ${cases} END WHERE id IN (${placeholders})`,
    [...ids],
  );
}
