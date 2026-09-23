import { create } from "zustand";
import { setSetting } from "../services/settingsRepo";
import type { ResolvedTheme, ThemePref } from "../types/models";

/** settings 表里使用的键名，集中在此避免各处硬编码字符串 */
export const SETTING_KEYS = {
  theme: "theme",
  tempDir: "tempDir",
  autoSaveToFile: "autoSaveToFile",
} as const;

interface SettingsState {
  /** 用户选择的主题偏好 */
  themePref: ThemePref;
  /** 系统当前主题，由 services/theme.ts 订阅后写入 */
  systemTheme: ResolvedTheme;
  /** 临时目录；空字符串表示使用默认目录 */
  tempDir: string;
  /** 打开的真实文件是否自动保存 */
  autoSaveToFile: boolean;
  setThemePref: (pref: ThemePref) => void;
  setSystemTheme: (theme: ResolvedTheme) => void;
  setTempDir: (dir: string) => void;
  setAutoSaveToFile: (enabled: boolean) => void;
  /** 启动时用数据库中的设置初始化 */
  hydrate: (values: Record<string, string>) => void;
}

function parseThemePref(value: string | undefined): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * 全局设置。每个 setter 同时写库，避免调用方漏掉持久化。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  themePref: "system",
  systemTheme: "light",
  tempDir: "",
  autoSaveToFile: true,

  hydrate: (values) =>
    set({
      themePref: parseThemePref(values[SETTING_KEYS.theme]),
      tempDir: values[SETTING_KEYS.tempDir] ?? "",
      autoSaveToFile: values[SETTING_KEYS.autoSaveToFile] !== "0",
    }),

  setThemePref: (themePref) => {
    set({ themePref });
    void setSetting(SETTING_KEYS.theme, themePref);
  },

  setSystemTheme: (systemTheme) => set({ systemTheme }),

  setTempDir: (tempDir) => {
    set({ tempDir });
    void setSetting(SETTING_KEYS.tempDir, tempDir);
  },

  setAutoSaveToFile: (autoSaveToFile) => {
    set({ autoSaveToFile });
    void setSetting(SETTING_KEYS.autoSaveToFile, autoSaveToFile ? "1" : "0");
  },
}));

/** 由偏好与系统主题算出实际要渲染的主题 */
export function resolveTheme(pref: ThemePref, system: ResolvedTheme): ResolvedTheme {
  return pref === "system" ? system : pref;
}
