"use client";

import type { useRouter } from "next/navigation";
import type { WorkspaceChange } from "@/features/collaboration/realtimeSync";

type Router = ReturnType<typeof useRouter>;
type PrefetchOptions = NonNullable<Parameters<Router["prefetch"]>[1]>;
type PreparedRoute = {
  requestedAt: number;
  preparedAt: number;
  dirty: boolean;
  invalidated: boolean;
  invalidationWaiters: Set<() => void>;
};

// Next 16.3.8's public router type and implementation support FULL. Its
// default AUTO only prepares the loading shell of our dynamic workspace.
const FULL = "full" as PrefetchOptions["kind"];
const INTENT_TTL_MS = 15_000;
const FRESHNESS_WINDOW_MS = 60_000;
const INVALIDATION_TIMEOUT_MS = 8_000;
const prepared = new Map<string, PreparedRoute>();
let currentIdentity = "";
let identityChangedWithCache = false;
let pendingNavigation: AbortController | null = null;

export function cancelPendingNavigation() {
  pendingNavigation?.abort();
  pendingNavigation = null;
}

export function trackPendingNavigation(controller: AbortController) {
  cancelPendingNavigation();
  pendingNavigation = controller;
  return () => { if (pendingNavigation === controller) pendingNavigation = null; };
}

export function setNavigationIdentity(identity: string) {
  if (currentIdentity === identity) return;
  cancelPendingNavigation();
  identityChangedWithCache ||= prepared.size > 0;
  prepared.clear();
  currentIdentity = identity;
}

export function releaseNavigationIdentity(identity: string) {
  if (currentIdentity === identity) setNavigationIdentity("");
}

function destination(href: unknown) {
  if (typeof window === "undefined" || typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return null;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const target = `${url.pathname}${url.search}`;
    if (target === `${window.location.pathname}${window.location.search}`) return null;
    return target;
  } catch { return null; }
}

export function prepareNavigation(router: Router, href: unknown, identity: string) {
  const target = destination(href);
  if (!target || process.env.NODE_ENV === "development" || navigator.onLine === false) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return;
  setNavigationIdentity(identity);
  const previous = prepared.get(target);
  // Never refresh the current page merely because a link was hovered. A
  // stale native snapshot is invalidated only on an actual navigation below.
  if (identityChangedWithCache || previous?.dirty) return;
  if (previous && Date.now() - previous.requestedAt < INTENT_TTL_MS) return;
  const entry: PreparedRoute = {
    requestedAt: Date.now(),
    // Repeating prefetch can hit Next's existing payload. It is not evidence
    // that a server read occurred, so keep the original freshness deadline.
    preparedAt: previous?.preparedAt ?? Date.now(),
    dirty: false,
    invalidated: false,
    invalidationWaiters: new Set(),
  };
  prepared.set(target, entry);
  try {
    router.prefetch(target, {
      kind: FULL,
      onInvalidate: () => {
        entry.invalidated = true;
        // A callback from an older request/account cannot evict a newer one.
        if (currentIdentity === identity && prepared.get(target) === entry) prepared.delete(target);
        entry.invalidationWaiters.forEach(notify => notify());
        entry.invalidationWaiters.clear();
      },
    });
  } catch {
    if (prepared.get(target) === entry) prepared.delete(target);
  }
}

export function markNavigationDataChanged(change: WorkspaceChange) {
  if (change.source === "connect" || (change.source === "local" && change.activityOnly)) return;
  if (change.source === "database" && change.table === "activities" && change.eventType === "UPDATE" && change.row.title === "") return;
  // Only metadata is retained here. Native RSC payloads remain in Next's
  // authenticated router cache; server-action invalidation removes entries
  // through onInvalidate before its later local activity announcement.
  prepared.forEach(entry => {
    // Polls are a missed-event fallback, not proof of a write. Bound the age
    // of prepared snapshots without making every 30-second poll force reads.
    if (change.source !== "poll" || Date.now() - entry.preparedAt >= FRESHNESS_WINDOW_MS) entry.dirty = true;
  });
}

export function needsFreshNavigation(href: unknown, identity: string) {
  const target = destination(href);
  if (!target) return false;
  setNavigationIdentity(identity);
  const entry = prepared.get(target);
  return identityChangedWithCache || Boolean(entry && (entry.dirty || Date.now() - entry.preparedAt >= FRESHNESS_WINDOW_MS));
}

export function waitForFreshNavigation(router: Router, href: unknown, identity: string, signal: AbortSignal): Promise<"fresh" | "reload" | "cancelled"> {
  const target = destination(href);
  if (signal.aborted || currentIdentity !== identity || !target) return Promise.resolve("cancelled");
  // After an account change the old native cache has no matching watcher.
  // A rare document navigation is safer than consuming another account's
  // snapshot or relying on a fire-and-forget refresh queued behind an action.
  if (identityChangedWithCache) return Promise.resolve("reload");
  const entry = prepared.get(target);
  if (!entry || entry.invalidated) return Promise.resolve("fresh");
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: "fresh" | "reload" | "cancelled") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      entry.invalidationWaiters.delete(invalidated);
      resolve(result);
    };
    const invalidated = () => finish("fresh");
    const cancel = () => finish("cancelled");
    const timer = setTimeout(() => finish("reload"), INVALIDATION_TIMEOUT_MS);
    entry.invalidationWaiters.add(invalidated);
    signal.addEventListener("abort", cancel, { once: true });
    // A queued Server Action/refresh may delay this invalidation. Start the
    // actual NAVIGATE only after Next acknowledges it through onInvalidate.
    // No current-page reads are triggered by hover, focus, touch, or polling.
    try { router.refresh(); } catch { finish("reload"); }
  });
}
