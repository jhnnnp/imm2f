import { useEffect, useRef, useState, type DragEvent } from "react";
import type { PlanItem } from "../types/plan";

export function PlanItemCard({
  item,
  index = 0,
  variant = "schedule",
  onDragStart,
  onDrop,
  onRemove,
  onEdit,
  onUpdate,
  onMovePrevious,
  onMoveNext,
  onMoveDay,
  dayCount = 1,
  editing,
  dragging,
  dropTarget,
  tossing = false,
  onDragEnter,
  onDragEnd,
  showTime = true,
}: {
  item: PlanItem;
  index?: number;
  variant?: "schedule" | "letter";
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onRemove?: (id: string) => void;
  onEdit: (id: string | null) => void;
  onUpdate?: (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => void;
  onMovePrevious?: () => void;
  onMoveNext?: () => void;
  onMoveDay?: (id: string, day: number) => void;
  dayCount?: number;
  editing: boolean;
  dragging: boolean;
  dropTarget: boolean;
  tossing?: boolean;
  onDragEnter: (id: string) => void;
  onDragEnd: () => void;
  showTime?: boolean;
}) {
  const letter = variant === "letter";
  const [startTime, setStartTime] = useState(item.startTime);
  const [durationMinutes, setDurationMinutes] = useState(item.durationMinutes);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setStartTime(item.startTime);
    setDurationMinutes(item.durationMinutes);
  }, [item.startTime, item.durationMinutes]);
  useEffect(() => {
    if (!menuOpen) return;
    const trigger = menuRef.current?.getBoundingClientRect();
    const menuHeight = menuRef.current?.querySelector<HTMLElement>(".item-action-menu")?.offsetHeight ?? 0;
    if (trigger) setMenuAbove(trigger.bottom + menuHeight > window.innerHeight - 90 && trigger.top > window.innerHeight - trigger.bottom);

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
  const stamp = String(index + 1).padStart(2, "0");
  return (
    <article
      className={`timeline-item ${letter ? "is-letter" : ""} ${dragging ? "is-dragging" : ""} ${tossing ? "is-toss" : ""} ${dropTarget ? "is-drop-target" : ""} ${editing ? "is-editing" : ""}`}
      draggable={!editing}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.setData("application/x-plan-item", item.id);
        onDragStart(item.id);
      }}
      onDragEnter={() => onDragEnter(item.id)}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onDrop={() => onDrop(item.id)}
    >
      {letter && <span className="letter-pin" aria-hidden="true" />}
      <div className="timeline-item-head">
        <button className="drag" type="button" aria-label={`${item.placeName} 순서 변경`} aria-haspopup="menu" aria-expanded={menuOpen} title="끌어서 이동하거나 눌러서 순서 변경" onPointerDown={event => event.stopPropagation()} onClick={() => setMenuOpen(open => !open)}>⠿</button>
        {letter ? <span className="letter-stamp">{stamp}</span> : showTime ? <time>{item.startTime}</time> : null}
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
            <div className={`item-action-menu${menuAbove ? " is-above" : ""}`} role="menu">
              <button type="button" role="menuitem" disabled={!onMovePrevious} onClick={() => { setMenuOpen(false); onMovePrevious?.(); }}>앞으로 이동</button>
              <button type="button" role="menuitem" disabled={!onMoveNext} onClick={() => { setMenuOpen(false); onMoveNext?.(); }}>뒤로 이동</button>
              {onUpdate && (
                <button type="button" role="menuitem" onClick={() => {
                  onEdit(editing ? null : item.id);
                  setMenuOpen(false);
                }}>{editing ? "시간 변경 취소" : "시간·소요 시간 변경"}</button>
              )}
              {onMoveDay && Array.from({ length: dayCount }, (_, day) => day === item.dayIndex ? null : <button key={day} type="button" role="menuitem" onClick={() => { setMenuOpen(false); onMoveDay(item.id, day); }}>DAY {day + 1}로 이동</button>)}
              {onRemove && (
                <button className="is-danger" type="button" role="menuitem" onClick={() => {
                  setMenuOpen(false);
                  onRemove(item.id);
                }}>{letter ? "이 장소 빼기" : "삭제"}</button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="timeline-item-body">
        <h3>{item.placeName}</h3>
        {(item.memo || (!letter && showTime)) && (
          <p>
            {item.memo && <span>{item.memo}</span>}
            {!letter && showTime && <small>{item.durationMinutes}분</small>}
          </p>
        )}
      </div>
      {editing && onUpdate && (
        <div className="timeline-edit-panel">
          <label><span>일정 시간</span><input type="time" step={300} required value={startTime} onChange={event => setStartTime(event.target.value)} /></label>
          <label><span>소요 시간</span><select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))}>{[...new Set([30, 45, 60, 90, 120, 150, 180, item.durationMinutes])].sort((a, b) => a - b).map(minutes => <option key={minutes} value={minutes}>{minutes >= 60 ? `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}` : `${minutes}분`}</option>)}</select></label>
          <button className="primary-button" type="button" disabled={!startTime || durationMinutes <= 0} onClick={() => {
            onUpdate?.(item.id, { startTime, durationMinutes });
            onEdit(null);
          }}>적용</button>
        </div>
      )}
    </article>
  );
}
