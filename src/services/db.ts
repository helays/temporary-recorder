import Database from "@tauri-apps/plugin-sql";

/**
 * 数据库位置：由 tauri-plugin-sql 解析 `sqlite:recorder.db`
 * 到应用数据目录下（随 bundle identifier 变化）。
 * 实际绝对路径可用 getDbPath() 取得。
 */
export const DB_URL = "sqlite:recorder.db";

/** 当前 schema 版本。v2 起内容不再存库，改为落在文件里（见 file_path / is_temp）。 */
const SCHEMA_VERSION = 2;

/**
 * 表结构。新库直接建成 v2 形状；
 * 老库由 migrate() 用 ALTER TABLE 补齐缺的列，两条路径最终一致。
 */
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
    updated_at  INTEGER NOT NULL,
    file_path   TEXT,
    is_temp     INTEGER NOT NULL DEFAULT 0,
    disk_mtime  INTEGER
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

/** v1 → v2 需要补上的列（列名与声明都是代码里的常量，不来自外部输入） */
const V2_COLUMNS: Array<{ name: string; declaration: string }> = [
  { name: "file_path", declaration: "TEXT" },
  { name: "is_temp", declaration: "INTEGER NOT NULL DEFAULT 0" },
  { name: "disk_mtime", declaration: "INTEGER" },
];

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

async function tableColumns(db: Database, table: string): Promise<Set<string>> {
  const rows = await db.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

/**
 * 补列。SQLite 没有 ADD COLUMN IF NOT EXISTS，所以先查 table_info；
 * 查不到表结构时退化为「直接尝试加列，重复列名就忽略」。
 */
async function addColumnIfMissing(
  db: Database,
  table: string,
  name: string,
  declaration: string,
): Promise<void> {
  try {
    const columns = await tableColumns(db, table);
    if (columns.has(name)) return;
  } catch (err) {
    console.warn("[db] 读取表结构失败，改为直接尝试加列:", err);
  }
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 列已存在（重复迁移 / 并发）时忽略
    if (!/duplicate column/i.test(message)) throw err;
  }
}

/** 建表 + 补列 + 写版本号，幂等 */
async function migrate(db: Database): Promise<void> {
  for (const sql of SCHEMA_STATEMENTS) {
    await db.execute(sql);
  }
  await db.execute(
    `INSERT OR IGNORE INTO session (id, active_tab_id, updated_at) VALUES (1, NULL, $1)`,
    [Date.now()],
  );

  for (const column of V2_COLUMNS) {
    await addColumnIfMissing(db, "tabs", column.name, column.declaration);
  }

  await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** 加载数据库并确保表结构存在（幂等，可重复调用） */
export function initDb(): Promise<Database> {
  if (instance !== null) return Promise.resolve(instance);
  if (loading === null) {
    loading = (async () => {
      const db = await Database.load(DB_URL);
      await migrate(db);
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
