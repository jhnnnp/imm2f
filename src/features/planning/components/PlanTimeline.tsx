"use client";

import { useRef, useState } from "react";
import type { PlanItem } from "../types/plan";
import { PlanItemCard } from "./PlanItemCard";

export function PlanTimeline({
  items,
  onReorder,
  onRemove,
  onUpdate,
}: {
  items: PlanItem[];
  onReorder: (items: PlanItem[]) => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => void;
}) {
  const dragged = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const drop = (targetId: string) => {
    if (!dragged.current || dragged.current === targetId) {
      setDraggingId(null);
      setOverId(null);
      return;
    }
    const reordered = [...items];
    const from = reordered.findIndex(item => item.id === dragged.current);
    const to = reordered.findIndex(item => item.id === targetId);
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    onReorder(reordered.map((item, order) => ({ ...item, order })));
    setDraggingId(null);
    setOverId(null);
  };

  if (!items.length) return null;

  return (
    <div className="timeline">
      {items.map((item, index) => (
        <div className="timeline-row" key={item.id}>
          <PlanItemCard
            item={item}
            onDragStart={id => { dragged.current = id; setDraggingId(id); }}
            onDragEnter={setOverId}
            onDragEnd={() => { dragged.current = null; setDraggingId(null); setOverId(null); }}
            onDrop={drop}
            onRemove={onRemove}
            onEdit={setEditingId}
            onUpdate={onUpdate}
            editing={editingId === item.id}
            dragging={draggingId === item.id}
            dropTarget={overId === item.id && draggingId !== item.id}
          />
          {index < items.length - 1 && <div className="travel-line"><span>↳</span> 다음 장소</div>}
        </div>
      ))}
    </div>
  );
}
