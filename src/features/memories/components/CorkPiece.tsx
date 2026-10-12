"use client";

import { useContext, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react";
import { CORK_DRAG_GAP, clamp, defaultCorkPose, draggedPose, normalizeRotation, pointerAngle, rotatedPose, type CorkPose } from "../corkLayout";
import { WORLD_H, WORLD_W } from "../canvasCamera";
import { MemoryCanvasContext } from "./MemoryCanvas";

export function CorkPiece({ id, index = 0, total = 8, className, poses, setPoses, draggingId, setDraggingId, onOpen, children }: {
  id: string;
  index?: number;
  total?: number;
  className?: string;
  poses: Record<string, CorkPose>;
  setPoses: Dispatch<SetStateAction<Record<string, CorkPose>>>;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const canvas = useContext(MemoryCanvasContext);
  const nodeRef = useRef<HTMLDivElement>(null);
  const posesRef = useRef(poses);
  posesRef.current = poses;
  const dragRef = useRef<{
    pointerId: number;
    mode: "move" | "rotate";
    startX: number;
    startY: number;
    startAngle: number;
    centerX: number;
    centerY: number;
    origin: CorkPose;
    raisedZ: number;
    hadPose: boolean;
    moved: boolean;
  } | null>(null);
  const pose = poses[id] ?? defaultCorkPose(index, total);
  const active = draggingId === id;
  const frontZ = () => canvas.nextLayerZ?.() ?? Math.max(8, total + 2, ...Object.values(posesRef.current).map(item => item.z)) + 1;

  function updatePose(next: CorkPose) {
    const nextPoses = { ...posesRef.current, [id]: next };
    posesRef.current = nextPoses;
    setPoses(nextPoses);
    return nextPoses;
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, mode: "move" | "rotate") {
    if (!canvas.interactive || event.button !== 0) return;
    event.stopPropagation();
    const node = nodeRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const current = posesRef.current[id] ?? defaultCorkPose(index, total);
    const box = node.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    dragRef.current = {
      pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY,
      startAngle: pointerAngle(centerX, centerY, event.clientX, event.clientY),
      centerX, centerY, origin: current, raisedZ: frontZ(), hadPose: id in posesRef.current, moved: false,
    };
    canvas.beginPieceEdit?.(cancelDrag);
    setDraggingId(id);
    try { node.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable for a cancelled touch. */ }
  }

  function cancelDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const next = { ...posesRef.current };
    if (drag.hadPose) next[id] = drag.origin;
    else delete next[id];
    posesRef.current = next;
    setPoses(next);
    setDraggingId(null);
    const node = nodeRef.current;
    if (node?.hasPointerCapture(drag.pointerId)) node.releasePointerCapture(drag.pointerId);
    canvas.endPieceEdit?.(next);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < CORK_DRAG_GAP) return;
    drag.moved = true;
    event.preventDefault();
    event.stopPropagation();
    const origin = { ...drag.origin, z: drag.raisedZ };
    if (drag.mode === "rotate") {
      updatePose(rotatedPose(origin, drag.startAngle, pointerAngle(drag.centerX, drag.centerY, event.clientX, event.clientY), event.shiftKey));
    } else {
      const next = draggedPose(origin, dx, dy, canvas.zoom);
      updatePose({ ...next, x: clamp(next.x, 0, WORLD_W - 180), y: clamp(next.y, 0, WORLD_H - 180) });
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    setDraggingId(null);
    const node = nodeRef.current;
    if (node?.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    if (cancelled && drag.moved) {
      const next = { ...posesRef.current };
      if (drag.hadPose) next[id] = drag.origin;
      else delete next[id];
      posesRef.current = next;
      setPoses(next);
    }
    canvas.endPieceEdit?.(posesRef.current);
    if (cancelled || drag.moved || drag.mode === "rotate") {
      // Pointer-up creates a click after a drag; discard that click only.
      const suppress = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
      node?.addEventListener("click", suppress, { capture: true, once: true });
      window.setTimeout(() => node?.removeEventListener("click", suppress, { capture: true }), 0);
      return;
    }
    onOpen?.();
  }

  function keyboardPose(next: CorkPose) {
    canvas.beginPieceEdit?.();
    const nextPoses = updatePose({ ...next, z: frontZ() });
    canvas.endPieceEdit?.(nextPoses);
  }

  return (
    <div
      ref={nodeRef}
      data-cork-id={id}
      className={`memory-cork-piece ${className ?? ""} ${active ? "is-dragging" : ""} ${canvas.interactive ? "" : "is-locked"}`}
      style={{ left: `${pose.x}px`, top: `${pose.y}px`, zIndex: active ? frontZ() : pose.z }}
      role="group"
      tabIndex={canvas.interactive ? 0 : -1}
      aria-label={onOpen ? "추억. Enter로 열기, 방향키로 이동, 대괄호 키로 회전." : "벽면 조각. 방향키로 이동, 대괄호 키로 회전."}
      onPointerDown={event => beginDrag(event, event.altKey ? "rotate" : "move")}
      onPointerMove={pointerMove}
      onPointerUp={event => finishDrag(event)}
      onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => { if (dragRef.current) finishDrag(event, true); }}
      onKeyDown={event => {
        if (!canvas.interactive || event.currentTarget !== event.target) return;
        const current = posesRef.current[id] ?? defaultCorkPose(index, total);
        if ((event.key === "Enter" || event.key === " ") && onOpen) {
          event.preventDefault(); event.stopPropagation(); onOpen(); return;
        }
        const step = event.shiftKey ? 28 : 14;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (dx || dy) {
          event.preventDefault();
          keyboardPose({ ...current, x: clamp(current.x + dx, 0, WORLD_W - 180), y: clamp(current.y + dy, 0, WORLD_H - 180) });
        } else if (event.key === "[" || event.key === "]") {
          event.preventDefault(); keyboardPose({ ...current, r: normalizeRotation(current.r + (event.key === "]" ? 4 : -4)) });
        }
      }}
    >
      {canvas.interactive && (
        <button className="memory-cork-rotate" type="button" aria-label="시계 방향으로 15도 돌리기" title="끌어서 회전 · Shift로 15도 맞추기"
          onPointerDown={event => beginDrag(event, "rotate")}
          onClick={event => { event.stopPropagation(); if (event.detail === 0) keyboardPose({ ...pose, r: normalizeRotation(pose.r + 15) }); }}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.8 12a7.2 7.2 0 0 1 12.3-5.1L19 5v6h-6l2.1-2.1A5.2 5.2 0 1 0 17.2 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <div className="memory-cork-inner" style={{ transform: `rotate(${pose.r}deg)${active ? " scale(1.03)" : ""}` }}>{children}</div>
    </div>
  );
}
