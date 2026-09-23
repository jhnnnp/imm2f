"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ContextPanelDrawer({ fallback }: { fallback: ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [hasOverride, setHasOverride] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"place" | "ai" | "guide">("guide");
  const [placeId, setPlaceId] = useState<string | null>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const sync = () => {
      const hasContent = slot.childElementCount > 0;
      setHasOverride(hasContent);
      const nextKind = slot.querySelector(".place-detail-panel") ? "place" : slot.querySelector(".ai-editor") ? "ai" : "guide";
      setKind(nextKind);
      setPlaceId(slot.querySelector(".place-detail-panel")?.getAttribute("data-place-id") ?? null);
      if (!hasContent) setOpen(false);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(slot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    if (placeId && hasOverride) setOpen(true);
  }, [placeId, hasOverride]);

  return (
    <>
      {hasOverride && !open && (
        <button
          className={`mobile-context-toggle ${open ? "is-open" : ""}`}
          type="button"
          aria-controls="app-context-panel"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {kind === "place" ? "장소 정보" : kind === "ai" ? "AI 편집" : "도움말"}
        </button>
      )}
      {open && <button className="mobile-context-scrim" type="button" aria-label="패널 닫기" onClick={() => setOpen(false)} />}
      <aside
        id="app-context-panel"
        className={`context-panel mobile-context-${kind} ${open ? "is-open" : ""}`}
        aria-label="상세 정보"
      >
        {hasOverride && <div className="mobile-context-head"><strong>{kind === "place" ? "장소 정보" : kind === "ai" ? "AI 편집" : "도움말"}</strong><button type="button" aria-label="패널 닫기" onClick={() => setOpen(false)}>닫기 ×</button></div>}
        <div id="context-panel-slot" ref={slotRef} />
        <div id="context-panel-default">{fallback}</div>
      </aside>
    </>
  );
}
