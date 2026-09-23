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
  /** 内容所在的文件；null 表示仍以 tabs.content 为准（迁移未完成的兜底） */
  file_path: string | null;
  /** 1 = 文件还在临时目录里（尚未另存为） */
  is_temp: number;
  /** 上次读写该文件时记录的修改时间，用于检测外部改动 */
  disk_mtime: number | null;
}

/** 完整标签记录：含内容（content 仅作 v1 迁移与异常兜底，正常不再写入） */
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

/**
 * 可格式化的文档格式：LanguageId 的子集。
 * 格式化 / 压缩只认这三种。
 */
export type DocFormat = "json" | "yaml" | "text";

/**
 * 语法高亮语言。
 * text 表示纯文本；json / yaml 同时是两种可格式化的格式。
 * 语言包按需动态加载，改动这里时同步维护 services/languages.ts 的语言表。
 */
export type LanguageId =
  | "text"
  | "json"
  | "yaml"
  | "markdown"
  | "html"
  | "css"
  | "xml"
  | "sql"
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "python"
  | "cpp"
  | "rust"
  | "go"
  | "java"
  | "powershell"
  | "shell"
  | "toml"
  | "ini"
  | "dockerfile"
  | "lua"
  | "ruby"
  | "perl"
  | "r";

/** 主题偏好：跟随系统 / 强制浅色 / 强制深色 */
export type ThemePref = "system" | "light" | "dark";

/** 实际渲染使用的主题 */
export type ResolvedTheme = "light" | "dark";

