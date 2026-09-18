"use client";

import { useContext, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import {
  CORK_DRAG_GAP,
  clamp,
  defaultCorkPose,
  draggedPose,
  normalizeRotation,
  pointerAngle,
  rotatedPose,
  type CorkPose,
} from "../corkLayout";
import { WORLD_H, WORLD_W } from "../canvasCamera";
import { MemoryCanvasContext } from "./MemoryCanvas";

export function CorkPiece({
  id,
  index = 0,
  total = 8,
  className,
  poses,
  setPoses,
  draggingId,
  setDraggingId,
  onOpen,
  children,
}: {
  id: string;
  index?: number;
  total?: number;
  className?: string;
  poses: Record<string, CorkPose>;
  setPoses: Dispatch<SetStateAction<Record<string, CorkPose>>>;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const canvas = useContext(MemoryCanvasContext);
  const zoom = canvas.zoom;
  const interactive = canvas.interactive;
  const nodeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    mode: "move" | "rotate";
    startX: number;
    startY: number;
    startAngle: number;
    origin: CorkPose;
    moved: boolean;
  } | null>(null);
  const pose = poses[id] ?? defaultCorkPose(index, total);
  const active = draggingId === id;

  function beginDrag(event: ReactPointerEvent<HTMLElement>, mode: "move" | "rotate") {
    if (!interactive || event.button !== 0) return;
    event.stopPropagation();
    const node = nodeRef.current;
    if (!node) return;
    const current = poses[id] ?? defaultCorkPose(index, total);
    const box = node.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startAngle: pointerAngle(box.left + box.width / 2, box.top + box.height / 2, event.clientX, event.clientY),
      origin: { ...current, z: Math.max(current.z, 8) + 1 },
      moved: mode === "rotate",
    };
    setDraggingId(id);
    setPoses(currentPoses => ({ ...currentPoses, [id]: { ...current, z: Math.max(current.z, 8) + 1 } }));
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events may not capture */
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const node = nodeRef.current;
    if (!drag || !node || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.mode === "move" && !drag.moved && (dx * dx + dy * dy) < CORK_DRAG_GAP * CORK_DRAG_GAP) return;
    drag.moved = true;
    event.preventDefault();
    if (drag.mode === "rotate") {
      const box = node.getBoundingClientRect();
      const angle = pointerAngle(box.left + box.width / 2, box.top + box.height / 2, event.clientX, event.clientY);
      const next = rotatedPose(drag.origin, drag.startAngle, angle, event.shiftKey);
      setPoses(current => ({ ...current, [id]: next }));
      return;
    }
    setPoses(current => ({ ...current, [id]: draggedPose(drag.origin, dx, dy, zoom) }));
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const node = nodeRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    if (node?.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      const suppress = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
      };
      node?.addEventListener("click", suppress, { capture: true, once: true });
      return;
    }
    onOpen?.();
  }

  return (
    <div
      ref={nodeRef}
      className={`memory-cork-piece ${className ?? ""} ${active ? "is-dragging" : ""} ${interactive ? "" : "is-locked"}`}
      style={{ left: `${pose.x}px`, top: `${pose.y}px`, zIndex: active ? 80 : pose.z }}
      role={onOpen ? "group" : undefined}
      tabIndex={onOpen && interactive ? 0 : undefined}
      aria-label={onOpen ? "추억 열기. 드래그하면 위치를 옮기고, 모서리를 돌리면 각도를 바꿀 수 있어요." : "벽면 조각. 드래그해서 옮길 수 있어요."}
      onPointerDown={event => beginDrag(event, event.altKey ? "rotate" : "move")}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={event => {
        if (!interactive) return;
        const current = poses[id] ?? defaultCorkPose(index, total);
        if (event.key === "Enter" || event.key === " ") {
          if (!onOpen) return;
          event.preventDefault();
          onOpen();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const step = event.shiftKey ? 28 : 14;
          const next = {
            ...current,
            x: clamp(event.key === "ArrowLeft" ? current.x - step : event.key === "ArrowRight" ? current.x + step : current.x, -80, WORLD_W - 80),
            y: clamp(event.key === "ArrowUp" ? current.y - step : event.key === "ArrowDown" ? current.y + step : current.y, -80, WORLD_H - 80),
            z: Math.max(current.z, 8) + 1,
          };
          setPoses(posesNow => ({ ...posesNow, [id]: next }));
          return;
        }
        if (event.key === "[" || event.key === "]") {
          event.preventDefault();
          const next = { ...current, r: normalizeRotation(current.r + (event.key === "]" ? 4 : -4)), z: Math.max(current.z, 8) + 1 };
          setPoses(posesNow => ({ ...posesNow, [id]: next }));
        }
      }}
    >
      {interactive && (
        <button
          className="memory-cork-rotate"
          type="button"
          aria-label="각도 돌리기"
          onPointerDown={event => {
            event.stopPropagation();
            beginDrag(event, "rotate");
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4.8 12a7.2 7.2 0 0 1 12.3-5.1L19 5v6h-6l2.1-2.1A5.2 5.2 0 1 0 17.2 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className="memory-cork-inner" style={{ transform: `rotate(${pose.r}deg)${active ? " scale(1.03)" : ""}` }}>
        {children}
      </div>
    </div>
  );
}
