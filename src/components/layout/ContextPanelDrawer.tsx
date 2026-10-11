"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const MOBILE_QUERY = "(max-width: 900px)";
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

export function ContextPanelDrawer({ fallback }: { fallback: ReactNode }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const mobile = useSyncExternalStore(subscribeViewport, isMobileViewport, serverViewport);
  const [hasOverride, setHasOverride] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"place" | "ai" | "guide">("guide");
  const [placeId, setPlaceId] = useState<string | null>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("only-us:open-context", show);
    return () => window.removeEventListener("only-us:open-context", show);
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
    if (!open) return;
    const previousFocus = document.activeElement;
    if (mobile) panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !mobile) return;
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex="0"]') ?? [])].filter(control => !control.hasAttribute("disabled") && control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (first && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      if (mobile && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open, mobile, hasOverride, kind]);

  useEffect(() => {
    if (hasOverride && (placeId || kind === "ai")) setOpen(true);
  }, [placeId, hasOverride, kind]);

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
        ref={panelRef}
        id="app-context-panel"
        className={`context-panel mobile-context-${kind} ${open ? "is-open" : ""}`}
        aria-label="상세 정보"
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-hidden={mobile && !open ? true : undefined}
        inert={mobile && !open}
      >
        {hasOverride && <div className="mobile-context-head"><strong>{kind === "place" ? "장소 정보" : kind === "ai" ? "AI 편집" : "도움말"}</strong><button type="button" aria-label="패널 닫기" onClick={() => setOpen(false)}>닫기 ×</button></div>}
        <div id="context-panel-slot" ref={slotRef} />
        <div id="context-panel-default">{fallback}</div>
      </aside>
    </>
  );
}
