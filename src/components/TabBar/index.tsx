import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
// 注意别名：直接叫 CSS 会和 DOM 的全局 CSS 对象（CSS.escape）冲突
import { CSS as DndCss } from "@dnd-kit/utilities";
import { useEffect, useRef, type CSSProperties } from "react";
import { useTabsStore } from "../../stores/tabsStore";
import type { TabMeta } from "../../types/models";
import { TabItem } from "./TabItem";

interface SortableTabItemProps {
  tab: TabMeta;
  active: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

/** 拖拽容器与展示组件分离，TabItem 保持与 dnd-kit 无关 */
function SortableTabItem({
  tab,
  active,
  onActivate,
  onClose,
  onRename,
}: SortableTabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });

  const style: CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      {...attributes}
      {...listeners}
      className="flex shrink-0"
    >
      <TabItem
        tab={tab}
        active={active}
        onActivate={onActivate}
        onClose={onClose}
        onRename={onRename}
      />
    </div>
  );
}

export function TabBar() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const createTab = useTabsStore((state) => state.createTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const renameTab = useTabsStore((state) => state.renameTab);
  const activateTab = useTabsStore((state) => state.activateTab);
  const applyOrder = useTabsStore((state) => state.applyOrder);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // 4px 阈值用来区分「点击切换」与「拖拽排序」
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // 原生滚动条已被 .tabstrip 隐藏，这里把滚轮（纵向或横向）映射为横向滚动。
  // 必须用原生监听器：React 的 onWheel 在根节点上是 passive 的，preventDefault 无效。
  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth) return; // 没溢出就不拦截
      const delta =
        Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      strip.scrollLeft += delta;
      event.preventDefault();
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // 让激活标签始终可见：用 Ctrl+Tab 连续切换时尤其重要
  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null || activeTabId === null) return;
    const target = strip.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeTabId)}"]`,
    );
    if (target === null) return;
    const left = target.offsetLeft;
    const right = left + target.offsetWidth;
    if (left < strip.scrollLeft) {
      strip.scrollLeft = left;
    } else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth;
    }
  }, [activeTabId, tabs.length]);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const ids = tabs.map((tab) => tab.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void applyOrder(arrayMove(ids, from, to));
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-app-border bg-app-panel">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((tab) => tab.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={stripRef}
            className="tabstrip relative flex min-w-0 flex-1 items-stretch overflow-x-auto"
          >
            {tabs.map((tab) => (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                onActivate={(id) => void activateTab(id)}
                onClose={(id) => void closeTab(id)}
                onRename={(id, title) => void renameTab(id, title)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        title="新建标签 (Ctrl+N / Ctrl+T)"
        onClick={() => void createTab()}
        className="shrink-0 border-l border-app-border px-3 text-sm text-app-muted hover:bg-app-hover hover:text-app-fg"
      >
        +
      </button>
    </div>
  );
}
