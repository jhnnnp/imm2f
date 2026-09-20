"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ContextPanelDrawer({ fallback }: { fallback: ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [hasOverride, setHasOverride] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const sync = () => {
      const hasContent = slot.childElementCount > 0;
      setHasOverride(hasContent);
      if (!hasContent) setOpen(false);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(slot, { childList: true });
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

  return (
    <>
      {hasOverride && (
        <button
          className={`mobile-context-toggle ${open ? "is-open" : ""}`}
          type="button"
          aria-controls="app-context-panel"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? "닫기" : "상세"}
        </button>
      )}
      <aside
        id="app-context-panel"
        className={`context-panel ${open ? "is-open" : ""}`}
        aria-label="상세 정보"
      >
        <div id="context-panel-slot" ref={slotRef} />
        <div id="context-panel-default">{fallback}</div>
      </aside>
    </>
  );
}
