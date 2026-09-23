import { read, write } from "./db";
import type { SettingsRow } from "../types/models";

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await read<SettingsRow>(
    "读取设置",
    `SELECT key, value FROM settings ORDER BY key ASC`,
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await read<{ value: string }>(
    "读取设置项",
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

export function setSetting(key: string, value: string): Promise<boolean> {
  return write(
    "保存设置项",
    `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** 删除设置项（例如标签被关掉之后，它那份「手动指定的语言」也该消失） */
export function deleteSetting(key: string): Promise<boolean> {
  return write("删除设置项", `DELETE FROM settings WHERE key = $1`, [key]);
}
