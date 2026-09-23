import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ResolvedTheme } from "../types/models";

/** 把主题落到根元素上：.dark 类驱动 CSS 变量，color-scheme 驱动原生控件 */
export function applyThemeToDocument(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function isTheme(value: unknown): value is ResolvedTheme {
  return value === "light" || value === "dark";
}

/**
 * 订阅系统主题变化，并立即回调一次当前值。
 *
 * 优先用 Tauri 的窗口主题（它是权威来源）；只有在拿不到时才退回 matchMedia。
 * 两者不并用——同时订阅会在二者不一致时互相覆盖。
 *
 * 返回取消订阅函数。
 */
export async function watchSystemTheme(
  onChange: (theme: ResolvedTheme) => void,
): Promise<() => void> {
  try {
    const current = await getCurrentWindow().theme();
    if (isTheme(current)) {
      onChange(current);
      return await getCurrentWindow().onThemeChanged(({ payload }) => {
        if (isTheme(payload)) onChange(payload);
      });
    }
  } catch (err) {
    console.error("[theme] 读取窗口主题失败，改用 prefers-color-scheme:", err);
  }

  const query = window.matchMedia("(prefers-color-scheme: dark)");
  onChange(query.matches ? "dark" : "light");
  const handler = (event: MediaQueryListEvent): void => {
    onChange(event.matches ? "dark" : "light");
  };
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
