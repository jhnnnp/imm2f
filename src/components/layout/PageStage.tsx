import type { ReactNode } from "react";

export function PageStage({ children }: { children: ReactNode }) {
  return <div className="page-stage">{children}</div>;
}
