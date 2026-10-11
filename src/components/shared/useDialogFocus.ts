"use client";

import { useEffect, useRef } from "react";

const CONTROLS = 'a[href], button, input, select, textarea, details > summary, [tabindex], [contenteditable="true"]';

function available(element: HTMLElement) {
  if (element.matches(":disabled") || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement && !node.open && !node.querySelector(":scope > summary")?.contains(element)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** Focus a modal once per opening; callbacks and controls may change in place. */
export function useDialogFocus<T extends HTMLElement>({ open, onClose, initialFocus }: {
  open: boolean;
  onClose: () => void;
  initialFocus?: string;
}) {
  const ref = useRef<T>(null);
  const latest = useRef({ onClose, initialFocus });
  latest.current = { onClose, initialFocus };

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const isTopDialog = () => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(available);
      return !dialogs.length || dialogs.at(-1) === dialog;
    };
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(CONTROLS)]
      .filter(element => element.tabIndex >= 0 && available(element));
    const focusInside = () => {
      const selectors = latest.current.initialFocus
        ? [latest.current.initialFocus]
        : ['[data-dialog-autofocus]', 'input:not([type="hidden"]):not([type="file"]), textarea, select'];
      for (const selector of selectors) {
        const preferred = [...dialog.querySelectorAll<HTMLElement>(selector)].find(available);
        if (!preferred) continue;
        preferred.focus();
        if (dialog.contains(document.activeElement)) return;
      }
      (controls()[0] ?? dialog).focus();
    };
    focusInside();
    const onKey = (event: KeyboardEvent) => {
      if (!isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onClose();
      } else if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        const active = document.activeElement;
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (!items.some(element => element === active) || event.shiftKey && active === first || !event.shiftKey && active === last) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    const containFocus = () => {
      const active = document.activeElement;
      if (isTopDialog() && (!dialog.contains(active) || active instanceof HTMLElement && !available(active))) focusInside();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", containFocus);
    // A preview or pending state may remove/disable the focused control.
    const observer = new MutationObserver(containFocus);
    observer.observe(dialog, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["disabled", "hidden", "inert", "aria-hidden", "style", "class", "open"] });
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", containFocus);
      if (previous?.isConnected && available(previous)) previous.focus();
    };
  }, [open]);

  return ref;
}
