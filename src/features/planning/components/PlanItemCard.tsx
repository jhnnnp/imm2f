import { useEffect, useRef, useState, type DragEvent } from "react";
import type { PlanItem } from "../types/plan";

export function PlanItemCard({
  item,
  onDragStart,
  onDrop,
  onRemove,
  onEdit,
  onUpdate,
  editing,
  dragging,
  dropTarget,
  onDragEnter,
  onDragEnd,
}: {
  item: PlanItem;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onRemove?: (id: string) => void;
  onEdit: (id: string | null) => void;
  onUpdate?: (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => void;
  editing: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragEnter: (id: string) => void;
  onDragEnd: () => void;
}) {
  const [startTime, setStartTime] = useState(item.startTime);
  const [durationMinutes, setDurationMinutes] = useState(item.durationMinutes);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setStartTime(item.startTime);
    setDurationMinutes(item.durationMinutes);
  }, [item.startTime, item.durationMinutes]);
  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  const handleDragOver = (event: DragEvent) => event.preventDefault();
  return (
    <article
      className={`timeline-item ${dragging ? "is-dragging" : ""} ${dropTarget ? "is-drop-target" : ""} ${editing ? "is-editing" : ""}`}
      draggable={!editing}
      onDragStart={() => onDragStart(item.id)}
      onDragEnter={() => onDragEnter(item.id)}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onDrop={() => onDrop(item.id)}
    >
      <div className="timeline-item-head">
        <button className="drag" type="button" aria-label="드래그하여 순서 변경" title="끌어서 순서 변경">⠿</button>
        <time>{item.startTime}</time>
        <span className="timeline-category">{item.category}</span>
        <div className="item-actions" ref={menuRef}>
          <button
            className="item-more"
            type="button"
            aria-label={`${item.placeName} 일정 메뉴`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            draggable={false}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setMenuOpen(open => !open)}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {menuOpen && (
            <div className="item-action-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => {
                onEdit(editing ? null : item.id);
                setMenuOpen(false);
              }}>{editing ? "시간 변경 취소" : "시간 변경"}</button>
              {onRemove && (
                <button className="is-danger" type="button" role="menuitem" onClick={() => {
                  setMenuOpen(false);
                  onRemove(item.id);
                }}>삭제</button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="timeline-item-body">
        <h3>{item.placeName}</h3>
        <p>
          {item.memo && <span>{item.memo}</span>}
          <small>{item.durationMinutes}분</small>
        </p>
      </div>
      {editing && (
        <div className="timeline-edit-panel">
          <label><span>일정 시간</span><input type="time" value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
          <label><span>소요 시간</span><select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))}>{[30, 45, 60, 90, 120, 150, 180].map(minutes => <option key={minutes} value={minutes}>{minutes >= 60 ? `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}` : `${minutes}분`}</option>)}</select></label>
          <button className="primary-button" type="button" onClick={() => {
            onUpdate?.(item.id, { startTime, durationMinutes });
            onEdit(null);
          }}>적용</button>
        </div>
      )}
    </article>
  );
}
