"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDialogFocus } from "@/components/shared/useDialogFocus";

const MOBILE_QUERY = "(max-width: 1279px)";
function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function isMobileViewport() { return window.matchMedia(MOBILE_QUERY).matches; }
function serverViewport() { return false; }

export function openContextPanel() {
  window.dispatchEvent(new Event("only-us:open-context"));
}
export function closeContextPanel() {
  window.dispatchEvent(new Event("only-us:close-context"));
}

export function ContextPanelDrawer({ fallback }: { fallback: ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const mobile = useSyncExternalStore(subscribeViewport, isMobileViewport, serverViewport);
  const [hasOverride, setHasOverride] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useDialogFocus<HTMLElement>({ open: mobile && open, onClose: () => setOpen(false), initialFocus: "[data-panel-close]" });
  const [kind, setKind] = useState<"place" | "ai" | "guide">("guide");
  const [placeId, setPlaceId] = useState<string | null>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    const hide = () => setOpen(false);
    window.addEventListener("only-us:open-context", show);
    window.addEventListener("only-us:close-context", hide);
    return () => {
      window.removeEventListener("only-us:open-context", show);
      window.removeEventListener("only-us:close-context", hide);
    };
  }, []);

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
    if (hasOverride && (placeId || kind === "ai")) setOpen(true);
  }, [placeId, hasOverride, kind]);

  return (
    <>
      {open && <button className="mobile-context-scrim" type="button" aria-label="패널 닫기" onClick={() => setOpen(false)} />}
      <aside
        ref={panelRef}
        id="app-context-panel"
        className={`context-panel mobile-context-${kind} ${open ? "is-open" : ""}`}
        aria-label="상세 정보"
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-hidden={mobile && !open ? true : undefined}
        inert={mobile && !open}
      >
        <div className="mobile-context-head"><strong>{kind === "place" ? "장소 정보" : kind === "ai" ? "AI 플래너" : "요약·가이드"}</strong><button data-panel-close type="button" aria-label="패널 닫기" onClick={() => setOpen(false)}>닫기 ×</button></div>
        <div id="context-panel-slot" ref={slotRef} />
        <div id="context-panel-default">{fallback}</div>
      </aside>
    </>
  );
}
