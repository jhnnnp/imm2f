"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { subscribeWorkspaceChanges } from "@/features/collaboration/realtimeSync";
import { isRelevantWorkspaceChange } from "@/features/collaboration/workspaceChange";

const CACHE_CHANGES = { tables: ["couple_folders", "couple_folder_items", "trip_drafts"] };
const DEBOUNCE_MS = 250;
const MIN_REFRESH_INTERVAL_MS = 1_000;
const RESUME_INTERVAL_MS = 30_000;
const HOME_ACTIVITY_PREFIXES = ["PLACE_", "TRIP_", "DATE_", "MEMORY_", "PARTNER_"];

/** Keep prefetched pages fresh even while their screen is not mounted. */
export function WorkspaceCacheSync() {
  const router = useRouter();
  const pathname = usePathname();
  const session = useAppSession();
  const userId = session.mode === "authenticated" ? session.userId : "";
  const coupleId = session.mode === "authenticated" ? session.coupleId : "";
  const scope = coupleId ? `${userId}:${coupleId}` : "";
  const currentScope = useRef(scope);
  const currentPathname = useRef(pathname);
  currentScope.current = scope;
  currentPathname.current = pathname;

  useEffect(() => {
    if (!coupleId) return;
    let stopped = false;
    let dirty = false;
    let lastRefresh = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (stopped || currentScope.current !== scope || !dirty || document.visibilityState !== "visible") return;
      dirty = false;
      lastRefresh = Date.now();
      // Next invalidates its client prefetch cache and warms visible links
      // again. This background refresh never intercepts or waits for a click.
      router.refresh();
    };
    const schedule = () => {
      if (stopped || currentScope.current !== scope) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, Math.max(DEBOUNCE_MS, MIN_REFRESH_INTERVAL_MS - (Date.now() - lastRefresh)));
    };
    const live = subscribeWorkspaceChanges(coupleId, change => {
      if (change.source === "poll" || change.source === "connect") return;
      // Feed dismissal deletes ordinary stories; persisted domain snapshots
      // are retained and hidden with title="", which the shared filter ignores.
      if (change.source === "database" && change.table === "activities" && change.eventType === "DELETE") return;
      if (!isRelevantWorkspaceChange(change, CACHE_CHANGES)) return;
      const action = change.source === "database" && typeof change.row.action === "string" ? change.row.action : "";
      if (currentPathname.current === "/" && (change.source !== "database" || (change.table === "activities" && (!action || HOME_ACTIVITY_PREFIXES.some(prefix => action.startsWith(prefix)))))) {
        // HomeWorkspaceSync already refreshes the server-owned home data and
        // invalidates the same native cache, including its periodic fallback.
        dirty = false;
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (change.source === "resume") {
        // Hidden changes remain dirty until the tab becomes visible. Focus,
        // pageshow and visibility events otherwise share one bounded refresh.
        if (dirty || Date.now() - lastRefresh >= RESUME_INTERVAL_MS) schedule();
        return;
      }
      schedule();
    }, { userId });
    return () => {
      stopped = true;
      clearTimeout(timer);
      live.unsubscribe();
    };
  }, [coupleId, router, scope, userId]);

  return null;
}
