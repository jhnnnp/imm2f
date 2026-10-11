"use client";

import { useLinkStatus } from "next/link";

export function NavigationProgress() {
  const { pending } = useLinkStatus();
  return pending ? <span className="nav-progress" aria-hidden="true" /> : null;
}
