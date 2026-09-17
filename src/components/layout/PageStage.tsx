"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageStage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="page-stage" key={pathname}>
      {children}
    </div>
  );
}
