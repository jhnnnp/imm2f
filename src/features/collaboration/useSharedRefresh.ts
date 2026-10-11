"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createRefreshQueue } from "./refreshQueue";
import { createReadGuard } from "./readGuard";
import { subscribeWorkspaceChanges } from "./realtimeSync";
import { isRelevantWorkspaceChange, type SharedRefreshOptions } from "./workspaceChange";
export type { SharedRefreshOptions } from "./workspaceChange";

export type SharedRefreshContext = { isCurrent: () => boolean };
/** One shared subscription; consumers reject obsolete responses after each await. */
export function useSharedRefresh(refresh: (context: SharedRefreshContext) => Promise<void>, options: SharedRefreshOptions = {}) {
  const session = useAppSession();
  const coupleId = session.mode === "authenticated" ? session.coupleId : "";
  const userId = session.mode === "authenticated" ? session.userId : "";
  const scope = session.mode === "authenticated" ? `${session.userId}:${coupleId}` : "";
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const retryRef = useRef(() => {});
  const callback = useRef(refresh);
  callback.current = refresh;
  const settings = useRef(options);
  settings.current = options;
  const guard = useRef(createReadGuard(scope));
  guard.current.updateScope(scope);
  useEffect(() => {
    if (!coupleId) return;
    let stopped = false;
    let lastRead = Date.now();
    const queue = createRefreshQueue(async () => {
      const isCurrentRead = guard.current.capture();
      const isCurrent = () => !stopped && isCurrentRead();
      await callback.current({ isCurrent });
      if (isCurrent()) lastRead = Date.now();
    }, { canRun: () => !stopped && latestScope.current === scope && document.visibilityState === "visible" });
    const retry = () => {
      if (stopped || latestScope.current !== scope) return;
      guard.current.invalidate();
      queue.schedule();
    };
    retryRef.current = retry;
    const live = subscribeWorkspaceChanges(coupleId, change => {
      if (!isRelevantWorkspaceChange(change, settings.current)) return;
      if (change.source === "poll" && Date.now() - lastRead < (settings.current.pollIntervalMs ?? 60_000)) return;
      guard.current.invalidate();
      queue.schedule();
    }, { refreshOnConnect: settings.current.refreshOnConnect, userId });
    return () => {
      stopped = true;
      if (retryRef.current === retry) retryRef.current = () => {};
      guard.current.invalidate();
      queue.stop();
      live.unsubscribe();
    };
  }, [coupleId, scope, userId]);
  return useCallback(() => retryRef.current(), []);
}
