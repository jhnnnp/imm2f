import { Suspense, type ReactNode } from "react";
import { PageLoading } from "./PageLoading";

export function RouteSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}
