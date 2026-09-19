"use client";

import { useEffect, useState, type RefObject } from "react";

const VEIL_ID = "toss-veil";

function setTossBlur(on: boolean) {
  document.documentElement.classList.toggle("is-toss-blur", on);
  let veil = document.getElementById(VEIL_ID);
  if (on && !veil) {
    veil = document.createElement("div");
    veil.id = VEIL_ID;
    veil.className = "toss-veil";
    veil.setAttribute("aria-hidden", "true");
    const hint = document.createElement("span");
    hint.textContent = "놓으면 지워져요";
    veil.appendChild(hint);
    document.body.appendChild(veil);
  }
}

export function useTossDismiss(
  active: boolean,
  boundRef: RefObject<HTMLElement | null>,
  padding = 36,
) {
  const [outside, setOutside] = useState(false);

  useEffect(() => {
    if (!active) {
      setOutside(false);
      return;
    }
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      const box = boundRef.current?.getBoundingClientRect();
      if (!box || (event.clientX === 0 && event.clientY === 0)) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-toss-safe]")) {
        setOutside(false);
        return;
      }
      setOutside(
        event.clientX < box.left - padding
        || event.clientX > box.right + padding
        || event.clientY < box.top - padding
        || event.clientY > box.bottom + padding,
      );
    };
    document.addEventListener("dragover", onDragOver);
    return () => document.removeEventListener("dragover", onDragOver);
  }, [active, boundRef, padding]);

  useEffect(() => {
    const blur = active && outside;
    setTossBlur(blur);
    return () => setTossBlur(false);
  }, [active, outside]);

  return outside;
}
