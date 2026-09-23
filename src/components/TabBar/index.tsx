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
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
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
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex shrink-0">
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

  // 4px 阈值用来区分「点击切换」与「拖拽排序」
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

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
    <div className="flex h-9 shrink-0 items-stretch border-b border-neutral-700 bg-neutral-950">
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
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
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
        title="新建标签 (Ctrl+T)"
        onClick={() => void createTab()}
        className="shrink-0 border-l border-neutral-700 px-3 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        +
      </button>
    </div>
  );
}
