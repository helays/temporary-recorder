import { create } from "zustand";
import { isKnownLanguageId } from "../services/languages";
import { deleteSetting, setSetting } from "../services/settingsRepo";
import type { LanguageId, ResolvedTheme, ThemePref } from "../types/models";

/** settings 表里使用的键名，集中在此避免各处硬编码字符串 */
export const SETTING_KEYS = {
  theme: "theme",
  tempDir: "tempDir",
  autoSaveToFile: "autoSaveToFile",
} as const;

/**
 * 「手动指定的语言」在 settings 表里的键前缀：`lang:<tabId>`。
 *
 * 刻意放进 settings 键值表而不是给 tabs 加一列：不用动已记录在 AGENTS.md 里的表结构，
 * 也就不需要 v3 迁移；代价是标签关掉时要顺手删键（见 tabsStore.closeTab）+
 * 启动时清一次孤儿键（见 languageActions.pruneLanguageOverrides）。
 */
export const LANGUAGE_KEY_PREFIX = "lang:";

interface SettingsState {
  /** 用户选择的主题偏好 */
  themePref: ThemePref;
  /** 系统当前主题，由 services/theme.ts 订阅后写入 */
  systemTheme: ResolvedTheme;
  /** 临时目录；空字符串表示使用默认目录 */
  tempDir: string;
  /** 打开的真实文件是否自动保存 */
  autoSaveToFile: boolean;
  /** 标签 id -> 用户手动指定的语言（没有键表示按文件名 / 内容自动识别） */
  languageOverrides: Record<string, LanguageId>;
  setThemePref: (pref: ThemePref) => void;
  setSystemTheme: (theme: ResolvedTheme) => void;
  setTempDir: (dir: string) => void;
  setAutoSaveToFile: (enabled: boolean) => void;
  /** 手动指定某标签的语言；null 表示恢复自动识别（键会被删掉） */
  setLanguageOverride: (tabId: string, language: LanguageId | null) => void;
  /** 清理指向已不存在标签的键，返回清掉的个数 */
  pruneLanguageOverrides: (validTabIds: readonly string[]) => number;
  /** 启动时用数据库中的设置初始化 */
  hydrate: (values: Record<string, string>) => void;
}

function parseThemePref(value: string | undefined): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

/** 从 settings 里挑出 `lang:` 前缀的键；认不出的值直接丢掉 */
function parseLanguageOverrides(values: Record<string, string>): Record<string, LanguageId> {
  const overrides: Record<string, LanguageId> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(LANGUAGE_KEY_PREFIX)) continue;
    const tabId = key.slice(LANGUAGE_KEY_PREFIX.length);
    if (tabId.length > 0 && isKnownLanguageId(value)) overrides[tabId] = value;
  }
  return overrides;
}

/**
 * 全局设置。每个 setter 同时写库，避免调用方漏掉持久化。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  themePref: "system",
  systemTheme: "light",
  tempDir: "",
  autoSaveToFile: true,
  languageOverrides: {},

  hydrate: (values) =>
    set({
      themePref: parseThemePref(values[SETTING_KEYS.theme]),
      tempDir: values[SETTING_KEYS.tempDir] ?? "",
      autoSaveToFile: values[SETTING_KEYS.autoSaveToFile] !== "0",
      languageOverrides: parseLanguageOverrides(values),
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

  setLanguageOverride: (tabId, language) => {
    set((state) => {
      const next = { ...state.languageOverrides };
      if (language === null) delete next[tabId];
      else next[tabId] = language;
      return { languageOverrides: next };
    });
    // 库写入失败只影响「下次启动是否记得」，当次高亮不受影响
    const key = `${LANGUAGE_KEY_PREFIX}${tabId}`;
    void (language === null ? deleteSetting(key) : setSetting(key, language));
  },

  pruneLanguageOverrides: (validTabIds) => {
    const valid = new Set(validTabIds);
    let removed = 0;
    set((state) => {
      const next: Record<string, LanguageId> = {};
      for (const [tabId, language] of Object.entries(state.languageOverrides)) {
        if (valid.has(tabId)) next[tabId] = language;
        else {
          removed += 1;
          void deleteSetting(`${LANGUAGE_KEY_PREFIX}${tabId}`);
        }
      }
      return { languageOverrides: next };
    });
    return removed;
  },
}));

/** 由偏好与系统主题算出实际要渲染的主题 */
export function resolveTheme(pref: ThemePref, system: ResolvedTheme): ResolvedTheme {
  return pref === "system" ? system : pref;
}
