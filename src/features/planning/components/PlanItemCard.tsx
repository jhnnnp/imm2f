import type { DragEvent } from "react";
import type { PlanItem } from "../types/plan";
import { formatWon } from "@/lib/dates";

export function PlanItemCard({
  item,
  onDragStart,
  onDrop,
  onRemove,
}: {
  item: PlanItem;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  const handleDragOver = (event: DragEvent) => event.preventDefault();
  return (
    <article className="timeline-item" draggable onDragStart={() => onDragStart(item.id)} onDragOver={handleDragOver} onDrop={() => onDrop(item.id)}>
      <button className="drag" type="button" aria-label="드래그하여 순서 변경">⠿</button>
      <time>{item.startTime}</time>
      <i />
      <div>
        <span>{item.category}</span>
        <h3>{item.placeName}</h3>
        <p>{item.memo ? `${item.memo} · ${item.durationMinutes}분` : `${item.durationMinutes}분`}</p>
      </div>
      <b>{item.expectedCost ? `₩${formatWon(item.expectedCost)}` : "무료"}</b>
      {onRemove && (
        <button className="item-menu" type="button" aria-label={`${item.placeName} 일정에서 빼기`} onClick={() => onRemove(item.id)}>빼기</button>
      )}
    </article>
  );
}
