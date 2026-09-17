"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ContextPanel({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setSlot(document.getElementById("context-panel-slot"));
  }, []);

  return (
    <>
      <span hidden data-context-override="" />
      {slot ? createPortal(<div className="context-panel-stage">{children}</div>, slot) : null}
    </>
  );
}
