"use client";

import { useRef } from "react";
import type { PlanItem } from "../types/plan";
import { PlanItemCard } from "./PlanItemCard";

export function PlanTimeline({
  items,
  onReorder,
  onRemove,
}: {
  items: PlanItem[];
  onReorder: (items: PlanItem[]) => void;
  onRemove?: (id: string) => void;
}) {
  const dragged = useRef<string | null>(null);
  const drop = (targetId: string) => {
    if (!dragged.current || dragged.current === targetId) return;
    const reordered = [...items];
    const from = reordered.findIndex(item => item.id === dragged.current);
    const to = reordered.findIndex(item => item.id === targetId);
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    onReorder(reordered.map((item, order) => ({ ...item, order })));
  };

  if (!items.length) return null;

  return (
    <div className="timeline">
      {items.map((item, index) => (
        <div key={item.id}>
          <PlanItemCard
            item={item}
            onDragStart={id => { dragged.current = id; }}
            onDrop={drop}
            onRemove={onRemove}
          />
          {index < items.length - 1 && <div className="travel-line"><span>↳</span> 다음 장소</div>}
        </div>
      ))}
    </div>
  );
}
