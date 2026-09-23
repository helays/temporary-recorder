import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { editorManager } from "../../extensions/editorManager";
import { buildMenuSections, runMenuAction, type MenuNode, type MenuSection } from "../../services/menu";
import { useSettingsStore } from "../../stores/settingsStore";

/** 可在菜单里用方向键走到的节点（分隔线与禁用项跳过） */
function navigableIds(section: MenuSection): string[] {
  const ids: string[] = [];
  for (const node of section.items) {
    if (node.kind === "separator") continue;
    if (node.kind === "item" && node.disabled === true) continue;
    ids.push(node.id);
  }
  return ids;
}

function nodeById(section: MenuSection, id: string): MenuNode | null {
  const found = section.items.find((node) => node.kind !== "separator" && node.id === id);
  return found ?? null;
}

/** 一行菜单项：左侧留出勾选位、中间标签、右侧快捷键或子菜单箭头 */
function Row({
  label,
  accelerator,
  checked,
  submenu,
  disabled,
  highlighted,
  onActivate,
  onHover,
}: {
  label: string;
  accelerator?: string;
  checked?: boolean;
  submenu?: boolean;
  disabled?: boolean;
  highlighted: boolean;
  onActivate: () => void;
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onActivate}
      onMouseMove={onHover}
      className={`flex w-full items-center gap-4 px-3 py-1 text-left text-xs whitespace-nowrap disabled:opacity-40 ${
        highlighted ? "bg-app-hover text-app-fg" : "text-app-fg"
      }`}
    >
      <span className="w-3 shrink-0 text-app-accent">{checked === true ? "✓" : ""}</span>
      <span className="flex-1">{label}</span>
      {accelerator !== undefined && <span className="text-app-muted">{accelerator}</span>}
      {submenu === true && <span className="text-app-muted">▸</span>}
    </button>
  );
}

/**
 * 顶部菜单栏（自绘）。
 *
 * 交互按 Windows 习惯来：
 * - 点顶级按钮展开；再点一次关闭
 * - 已有菜单展开时，鼠标移到别的顶级按钮直接切换
 * - 点菜单项、点面板外、按 Esc 都会关闭（Esc 还会把焦点还给编辑器）
 * - 方向键 ←/→ 换顶级菜单，↑/↓ 移动高亮项，Enter 执行
 *
 * 注意面板上的 data-tauri-drag-region="false"：标题栏整体是拖动区，
 * 不显式关掉的话，点面板的空白处会把窗口拖走。
 */
export function MenuBar() {
  const themePref = useSettingsStore((state) => state.themePref);
  const sections = buildMenuSections(themePref);

  const [openSection, setOpenSection] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /**
   * 当前展开的菜单是「点开的」还是「鼠标划过的」。
   *
   * 必须有这个区分：菜单已展开时，鼠标移到别的顶级按钮会立刻打开它（Windows 习惯），
   * 此时若点击也按 toggle 处理，就会把刚划开的菜单一下关掉——用户看到的是菜单闪一下就没了。
   * 规则：点开的再点一次才关闭；划开的第一次点击只是「确认打开」。
   */
  const openedByClickRef = useRef(false);

  const closeMenu = useCallback((): void => {
    openedByClickRef.current = false;
    setOpenSection(null);
    setActiveItem(null);
    setOpenSubmenu(null);
  }, []);

  const openSectionById = useCallback(
    (id: string): void => {
      const section = sections.find((item) => item.id === id);
      if (section === undefined) return;
      setOpenSection(id);
      setOpenSubmenu(null);
      setActiveItem(navigableIds(section)[0] ?? null);
    },
    [sections],
  );

  // 点面板外面就关掉
  useEffect(() => {
    if (openSection === null) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openSection, closeMenu]);

  const runNode = (node: MenuNode): void => {
    if (node.kind === "separator" || node.kind === "submenu") return;
    if (node.kind === "item" && node.disabled === true) return;
    closeMenu();
    runMenuAction(node.run);
  };

  const currentSection = sections.find((item) => item.id === openSection) ?? null;

  const moveWithin = (delta: number): void => {
    if (currentSection === null) return;
    const ids = navigableIds(currentSection);
    if (ids.length === 0) return;
    const index = activeItem === null ? -1 : ids.indexOf(activeItem);
    const next = index < 0 ? 0 : (index + delta + ids.length) % ids.length;
    setActiveItem(ids[next]);
    setOpenSubmenu(null);
  };

  const moveSection = (delta: number): void => {
    if (currentSection === null) return;
    const index = sections.findIndex((item) => item.id === currentSection.id);
    const next = (index + delta + sections.length) % sections.length;
    openSectionById(sections[next].id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (openSection === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      editorManager.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveWithin(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveWithin(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSection(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSection(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (currentSection !== null && activeItem !== null) {
        const node = nodeById(currentSection, activeItem);
        if (node !== null) {
          if (node.kind === "submenu") setOpenSubmenu(node.id);
          else runNode(node);
        }
      }
    }
  };

  /** 渲染一个叶子节点（普通项 / 勾选项） */
  const renderLeaf = (node: MenuNode, key: string): ReactNode => {
    if (node.kind === "separator") {
      return <div key={key} className="my-1 h-px bg-app-border" />;
    }
    if (node.kind === "submenu") return null;
    return (
      <Row
        key={key}
        label={node.label}
        accelerator={node.kind === "item" ? node.accelerator : undefined}
        checked={node.kind === "check" ? node.checked : undefined}
        disabled={node.kind === "item" ? node.disabled : undefined}
        highlighted={activeItem === node.id}
        onActivate={() => {
          runNode(node);
        }}
        onHover={() => setActiveItem(node.id)}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      role="menubar"
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-stretch"
    >
      {sections.map((section) => {
        const open = openSection === section.id;
        return (
          <div key={section.id} className="relative flex items-stretch">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => {
                if (open && openedByClickRef.current) {
                  closeMenu();
                  return;
                }
                openedByClickRef.current = true;
                openSectionById(section.id);
              }}
              onMouseEnter={() => {
                // 只有在已经有菜单展开时才跟随鼠标切换，否则会变成"划过就弹"
                if (openSection !== null && !open) {
                  openedByClickRef.current = false;
                  openSectionById(section.id);
                }
              }}
              className={`px-2 text-xs ${
                open ? "bg-app-hover text-app-fg" : "text-app-fg hover:bg-app-hover"
              }`}
            >
              {section.label}
            </button>

            {open && (
              <div
                data-tauri-drag-region="false"
                role="menu"
                className="absolute top-full left-0 z-20 w-max min-w-48 rounded-md border border-app-border bg-app-panel py-1 shadow-lg"
              >
                {section.items.map((node, index) => {
                  if (node.kind !== "submenu") return renderLeaf(node, `${section.id}-${index}`);

                  const submenuOpen = openSubmenu === node.id;
                  return (
                    <div
                      key={node.id}
                      className="relative"
                      onMouseEnter={() => {
                        setActiveItem(node.id);
                        setOpenSubmenu(node.id);
                      }}
                      onMouseLeave={() => setOpenSubmenu(null)}
                    >
                      <Row
                        label={node.label}
                        submenu
                        highlighted={activeItem === node.id}
                        onActivate={() => setOpenSubmenu(submenuOpen ? null : node.id)}
                      />
                      {submenuOpen && (
                        <div
                          data-tauri-drag-region="false"
                          role="menu"
                          className="absolute top-0 left-full z-20 w-max min-w-40 rounded-md border border-app-border bg-app-panel py-1 shadow-lg"
                        >
                          {node.items.map((child, childIndex) =>
                            renderLeaf(child, `${node.id}-${childIndex}`),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
