import type { DragEvent } from "react";
import type { PlanItem } from "../types/plan";

export function PlanItemCard({ item, onDragStart, onDrop }: { item: PlanItem; onDragStart: (id: string) => void; onDrop: (id: string) => void }) {
  const handleDragOver = (event: DragEvent) => event.preventDefault();
  return <article className="timeline-item" draggable onDragStart={() => onDragStart(item.id)} onDragOver={handleDragOver} onDrop={() => onDrop(item.id)}>
    <button className="drag" aria-label="드래그하여 순서 변경">⠿</button><time>{item.startTime}</time><i /><div><span>{item.category}</span><h3>{item.placeName}</h3><p>{item.memo} · {item.durationMinutes}분</p></div><b>{item.expectedCost ? `₩${item.expectedCost.toLocaleString("ko-KR")}` : "무료"}</b><button className="item-menu" aria-label="일정 메뉴">•••</button>
  </article>;
}
