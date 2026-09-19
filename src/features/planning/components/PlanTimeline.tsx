"use client";

import { useRef, useState } from "react";
import { useTossDismiss } from "@/lib/useTossDismiss";
import type { PlanItem } from "../types/plan";
import { PlanItemCard } from "./PlanItemCard";

export function PlanTimeline({
  items,
  onReorder,
  onRemove,
  onUpdate,
  onDragSessionStart,
  onDragSessionEnd,
  consumeExternalDrop,
  columns = 1,
  fill = false,
  variant = "schedule",
}: {
  items: PlanItem[];
  onReorder: (items: PlanItem[]) => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => void;
  onDragSessionStart?: (id: string) => void;
  onDragSessionEnd?: () => void;
  /** Return true when a drop was handled outside this list (e.g. another day). */
  consumeExternalDrop?: () => boolean;
  columns?: 1 | 2;
  fill?: boolean;
  variant?: "schedule" | "letter";
}) {
  const boundRef = useRef<HTMLDivElement>(null);
  const dragged = useRef<string | null>(null);
  const droppedInside = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dismissing = useTossDismiss(Boolean(draggingId), boundRef);
  const dismissingRef = useRef(false);
  dismissingRef.current = dismissing;
  const drop = (targetId: string) => {
    droppedInside.current = true;
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

  const grid = columns === 2 && items.length >= 4;
  const density = items.length <= 1 ? "roomy" : items.length <= 3 ? "comfortable" : items.length <= 6 ? "balanced" : "compact";

  return (
    <div
      ref={boundRef}
      className={`timeline${grid ? " is-grid" : ""}${fill ? ` is-fill is-${density}` : ""}${variant === "letter" ? " is-letter" : ""}${dismissing ? " is-tossing" : ""}`}
      data-count={items.length}
      data-toss-hint="바깥에 놓으면 지워져요"
    >
      {items.map((item, index) => (
        <div className="timeline-row" key={item.id}>
          <PlanItemCard
            item={item}
            index={index}
            variant={variant}
            tossing={draggingId === item.id && dismissing}
            onDragStart={id => {
              dragged.current = id;
              droppedInside.current = false;
              setDraggingId(id);
              onDragSessionStart?.(id);
            }}
            onDragEnter={id => { if (!dismissing) setOverId(id); }}
            onDragEnd={() => {
              const handledOutside = consumeExternalDrop?.() ?? false;
              if (!handledOutside && !droppedInside.current && dismissingRef.current && dragged.current && onRemove) {
                onRemove(dragged.current);
              }
              dragged.current = null;
              setDraggingId(null);
              setOverId(null);
              onDragSessionEnd?.();
            }}
            onDrop={drop}
            onRemove={onRemove}
            onEdit={setEditingId}
            onUpdate={onUpdate}
            editing={editingId === item.id}
            dragging={draggingId === item.id}
            dropTarget={overId === item.id && draggingId !== item.id && !dismissing}
          />
          {!grid && index < items.length - 1 && (
            <div className={`travel-line${variant === "letter" ? " is-letter" : ""}`}>
              {variant === "letter" ? "그리고" : <><span>↳</span> 다음 장소</>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
