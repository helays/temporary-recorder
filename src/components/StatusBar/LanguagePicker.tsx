import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { editorManager } from "../../extensions/editorManager";
import { applyLanguageChoice } from "../../services/languageActions";
import { languageLabel, listLanguages } from "../../services/languages";
import { useSettingsStore } from "../../stores/settingsStore";
import { useStatusStore } from "../../stores/statusStore";
import { useTabsStore } from "../../stores/tabsStore";
import type { LanguageId } from "../../types/models";

/**
 * 状态栏上的语言胶囊 + 手动选择下拉。
 *
 * 存在的理由：新建标签的临时文件固定叫 `未命名 1-xxxx.txt`，没有扩展名可依，
 * 只能按内容嗅探；嗅探认不出来（或者认错了）时，用户得有个地方把它改对，
 * 而且这个选择要跨重启保留。
 *
 * 交互按 Windows 习惯（与自绘菜单一致）：
 * - 点胶囊展开；再点一次关闭；点面板外关闭
 * - Esc 关闭并把焦点还给编辑器
 * - ↑/↓ 移动高亮，Enter 选中
 * - 面板向上弹（状态栏在窗口最底部）
 */

interface Choice {
  /** null = 自动识别 */
  readonly id: LanguageId | null;
  readonly label: string;
  readonly hint?: string;
}

const CHOICES: readonly Choice[] = [
  { id: null, label: "自动识别", hint: "按内容猜" },
  ...listLanguages().map((entry) => ({ id: entry.id, label: entry.label })),
];

export function LanguagePicker() {
  const language = useStatusStore((state) => state.language);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const override = useSettingsStore((state) =>
    activeTabId === null ? undefined : state.languageOverrides[activeTabId],
  );

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点面板外面就关掉
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // 展开时把高亮停在当前选择上
  const selectedIndex = useMemo(() => {
    const index = CHOICES.findIndex((choice) => choice.id === (override ?? null));
    return index < 0 ? 0 : index;
  }, [override]);

  const openMenu = (): void => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const choose = (choice: Choice): void => {
    setOpen(false);
    applyLanguageChoice(choice.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (open) setOpen(false);
      editorManager.focus();
      return;
    }
    if (!open) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % CHOICES.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + CHOICES.length) % CHOICES.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(CHOICES[activeIndex]);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const label = override === undefined ? languageLabel(language) : languageLabel(override);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="点击选择语言（自动识别失败时可以手动指定）"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`rounded-sm px-1 ${
          open ? "bg-app-hover text-app-fg" : "bg-app-hover text-app-fg hover:text-app-accent"
        }`}
      >
        {label}
        {override !== undefined && <span className="ml-0.5 text-app-accent">•</span>}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 max-h-72 w-max min-w-40 overflow-y-auto rounded-md border border-app-border bg-app-panel py-1 shadow-lg"
        >
          {CHOICES.map((choice, index) => {
            const checked = choice.id === (override ?? null);
            return (
              <button
                key={choice.id ?? "auto"}
                type="button"
                role="menuitem"
                onClick={() => choose(choice)}
                onMouseMove={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-3 px-3 py-1 text-left text-xs whitespace-nowrap ${
                  index === activeIndex ? "bg-app-hover text-app-fg" : "text-app-fg"
                }`}
              >
                <span className="w-3 shrink-0 text-app-accent">{checked ? "✓" : ""}</span>
                <span className="flex-1">{choice.label}</span>
                {choice.hint !== undefined && <span className="text-app-muted">{choice.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
