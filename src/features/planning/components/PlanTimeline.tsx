"use client";

import { useRef } from "react";
import type { PlanItem } from "../types/plan";
import { PlanItemCard } from "./PlanItemCard";

export function PlanTimeline({ items, onReorder }: { items: PlanItem[]; onReorder: (items: PlanItem[]) => void }) {
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
  return <div className="timeline">{items.map((item, index) => <div key={item.id}><PlanItemCard item={item} onDragStart={id => { dragged.current = id; }} onDrop={drop} />{index < items.length - 1 && <div className="travel-line"><span>↳</span> {index === 2 ? "택시 12분 · ₩8,400" : `도보 ${index === 0 ? 4 : 8}분 · ${index === 0 ? 280 : 540}m`}</div>}</div>)}</div>;
}
