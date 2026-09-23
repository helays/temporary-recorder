/** 标签元数据：不含 content，用于标签栏展示与排序 */
export interface TabMeta {
  id: string;
  title: string;
  sort_order: number;
  cursor_line: number;
  cursor_ch: number;
  scroll_top: number;
  created_at: number;
  updated_at: number;
}

/** 完整标签记录：含内容 */
export interface TabRecord extends TabMeta {
  content: string;
}

/** 会话表只存一行（id 固定为 1） */
export interface SessionRow {
  id: number;
  active_tab_id: string | null;
  window_width: number | null;
  window_height: number | null;
  window_x: number | null;
  window_y: number | null;
  updated_at: number;
}

export interface SettingsRow {
  key: string;
  value: string;
}

/** 窗口几何，单位为逻辑像素（与 DPI 无关） */
export interface WindowGeometry {
  width: number;
  height: number;
  x: number;
  y: number;
}

/** 格式化 / 压缩结果：失败时带位置信息，交由状态栏展示 */
export type FormatResult =
  | { ok: true; value: string; changed: boolean }
  | { ok: false; message: string; line?: number; column?: number };

/** 编辑器支持的文档格式 */
export type DocFormat = "json" | "yaml" | "text";

/** 主题偏好：跟随系统 / 强制浅色 / 强制深色 */
export type ThemePref = "system" | "light" | "dark";

/** 实际渲染使用的主题 */
export type ResolvedTheme = "light" | "dark";

