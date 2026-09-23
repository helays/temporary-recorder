import Database from "@tauri-apps/plugin-sql";

/**
 * 数据库位置：由 tauri-plugin-sql 解析 `sqlite:recorder.db`
 * 到应用数据目录下（随 bundle identifier 变化）。
 * 实际绝对路径可用 getDbPath() 取得。
 */
export const DB_URL = "sqlite:recorder.db";

/** 表结构。启动时以 CREATE TABLE IF NOT EXISTS 幂等建立 */
const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS tabs (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL,
    cursor_line INTEGER NOT NULL DEFAULT 0,
    cursor_ch   INTEGER NOT NULL DEFAULT 0,
    scroll_top  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    active_tab_id TEXT,
    window_width  INTEGER,
    window_height INTEGER,
    window_x      INTEGER,
    window_y      INTEGER,
    updated_at    INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tabs_sort_order ON tabs (sort_order)`,
];

/** 当前 schema 版本，写入 PRAGMA user_version */
const SCHEMA_VERSION = 1;

let instance: Database | null = null;
let loading: Promise<Database> | null = null;

type DbErrorHandler = (message: string) => void;
let onError: DbErrorHandler | null = null;

/**
 * 注册数据库错误回调。
 * 数据库读写失败时在状态栏显示错误信息，不崩溃、不弹窗。
 */
export function setDbErrorHandler(handler: DbErrorHandler | null): void {
  onError = handler;
}

function report(label: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[db] ${label} 失败:`, err);
  onError?.(`数据库操作失败（${label}）：${detail}`);
}

/** 加载数据库并确保表结构存在（幂等，可重复调用） */
export function initDb(): Promise<Database> {
  if (instance !== null) return Promise.resolve(instance);
  if (loading === null) {
    loading = (async () => {
      const db = await Database.load(DB_URL);
      for (const sql of SCHEMA_STATEMENTS) {
        await db.execute(sql);
      }
      // 会话表固定一行
      await db.execute(
        `INSERT OR IGNORE INTO session (id, active_tab_id, updated_at) VALUES (1, NULL, $1)`,
        [Date.now()],
      );
      await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      instance = db;
      return db;
    })().catch((err: unknown) => {
      loading = null;
      report("初始化", err);
      throw err;
    });
  }
  return loading;
}

/**
 * 数据库文件的实际绝对路径（插件解析后回传）。
 * 启动时打印，便于确认与用外部工具查验内容。
 */
export async function getDbPath(): Promise<string | null> {
  try {
    return (await initDb()).path;
  } catch {
    return null;
  }
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * 串行执行数据库操作。
 * tauri-plugin-sql 只暴露 execute / select，没有事务 API；
 * 串行化是避免「重命名」与「内容保存」乱序覆盖的手段。
 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 执行写语句。失败时上报状态栏并返回 false，不向调用方抛出，
 * 以保证单次写失败不会中断 UI（关闭标签、切换标签等仍需继续）。
 */
export function write(label: string, sql: string, params: unknown[] = []): Promise<boolean> {
  return serialize(async () => {
    try {
      const db = await initDb();
      await db.execute(sql, params);
      return true;
    } catch (err) {
      report(label, err);
      return false;
    }
  });
}

/** 执行查询。失败时上报状态栏并返回空数组，调用方按「无数据」处理 */
export async function read<T>(
  label: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const db = await initDb();
    return await db.select<T[]>(sql, params);
  } catch (err) {
    report(label, err);
    return [];
  }
}
