import { read, write } from "./db";
import type { SessionRow, WindowGeometry } from "../types/models";

const SESSION_COLUMNS =
  "id, active_tab_id, window_width, window_height, window_x, window_y, updated_at";

export async function readSession(): Promise<SessionRow | null> {
  const rows = await read<SessionRow>(
    "读取会话",
    `SELECT ${SESSION_COLUMNS} FROM session WHERE id = 1`,
  );
  return rows.length > 0 ? rows[0] : null;
}

export function writeActiveTab(tabId: string | null): Promise<boolean> {
  return write(
    "保存激活标签",
    `UPDATE session SET active_tab_id = $1, updated_at = $2 WHERE id = 1`,
    [tabId, Date.now()],
  );
}

export function writeWindowGeometry(geometry: WindowGeometry): Promise<boolean> {
  return write(
    "保存窗口位置",
    `UPDATE session
        SET window_width = $1, window_height = $2, window_x = $3, window_y = $4, updated_at = $5
      WHERE id = 1`,
    [geometry.width, geometry.height, geometry.x, geometry.y, Date.now()],
  );
}
