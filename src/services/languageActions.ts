import { editorManager } from "../extensions/editorManager";
import { languageLabel } from "./languages";
import { useSettingsStore } from "../stores/settingsStore";
import { useStatusStore } from "../stores/statusStore";
import { useTabsStore } from "../stores/tabsStore";
import type { LanguageId } from "../types/models";

/**
 * 「手动选择语言」的动作层：把状态栏下拉的选择落到三处——
 * 编辑器（立刻生效）、settings 表（跨重启记得）、状态栏提示。
 *
 * 优先级（与 services/session.ts 的恢复逻辑一致）：
 * 手动选择 > 文件名 > 内容嗅探。
 */

/** 手动指定当前标签的语言；language 为 null 表示恢复自动识别 */
export function applyLanguageChoice(language: LanguageId | null): void {
  const tabId = useTabsStore.getState().activeTabId;
  if (tabId === null) return;

  // 先落库：即使语法包加载失败，用户的选择本身也不该丢
  useSettingsStore.getState().setLanguageOverride(tabId, language);
  editorManager.setActiveLanguage(language);

  useStatusStore.getState().setMessage({
    kind: "info",
    text: language === null ? "语言已恢复为自动识别" : `已把当前标签设为「${languageLabel(language)}」`,
  });
}

/**
 * 启动时清掉指向已不存在标签的选择。
 * 标签关闭时本来就会删键（tabsStore.closeTab），这里是兜底：
 * 例如关应用前没能删掉、或数据库被换过。
 */
export function pruneLanguageOverrides(): void {
  const tabIds = useTabsStore.getState().tabs.map((tab) => tab.id);
  const removed = useSettingsStore.getState().pruneLanguageOverrides(tabIds);
  if (removed > 0) console.info(`[language] 清理了 ${removed} 条已失效的语言选择`);
}
