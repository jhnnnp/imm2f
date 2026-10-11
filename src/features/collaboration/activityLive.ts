"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createClient } from "@/lib/supabase/client";
import { mapActivityRows, type ActivityRecord } from "./activityMap";
import { forgetDismissedIds, rememberDismissedIds, withoutDismissedActivities } from "./activityFeed";
import type { CoupleActivity } from "./types";
import { createRefreshQueue } from "./refreshQueue";
import { subscribeWorkspaceChanges, type WorkspaceChange } from "./realtimeSync";
import { createReadGuard } from "./readGuard";

const FEED_LIMIT = 20;

async function loadNames(ids: string[], signal?: AbortSignal) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const supabase = createClient();
  if (!supabase) return new Map<string, string>();
  let query = supabase.from("profiles").select("id, display_name").in("id", unique);
  if (signal) query = query.abortSignal(signal);
  try {
    const { data, error } = await query;
    // Activity content remains useful when a departed actor's profile is no
    // longer readable. Names from the verified session cover current members.
    if (error) return new Map<string, string>();
    return new Map((data ?? []).map(row => [row.id, row.display_name || "파트너"]));
  } catch { return new Map<string, string>(); }
}

export async function fetchCoupleActivitiesLive(coupleId: string, limit = FEED_LIMIT, options: { names?: Map<string, string>; signal?: AbortSignal } = {}): Promise<CoupleActivity[]> {
  const supabase = createClient();
  if (!supabase) return [];
  let query = supabase
    .from("activities")
    .select("id, action, title, detail, actor_user_id, created_at")
    .eq("couple_id", coupleId)
    .neq("entity_type", "date_draft")
    .neq("title", "")
    .order("created_at", { ascending: false })
    .limit(Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.round(limit))) : FEED_LIMIT);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw new Error("이야기를 불러오지 못했어요.");
  const rows = (data ?? []) as ActivityRecord[];
  const names = new Map(options.names);
  const missing = rows.flatMap(row => row.actor_user_id && !names.has(row.actor_user_id) ? [row.actor_user_id] : []);
  if (missing.length && !options.signal?.aborted) {
    const extra = await loadNames(missing, options.signal);
    extra.forEach((name, id) => names.set(id, name));
  }
  return mapActivityRows(rows, names);
}

export function subscribeCoupleActivities(coupleId: string, onChange: (change: WorkspaceChange) => void, userId?: string) {
  return subscribeWorkspaceChanges(coupleId, change => {
    if (change.source !== "database" || change.table === "activities") onChange(change);
  }, { refreshOnConnect: true, userId });
}

type FeedSnapshot = { items: CoupleActivity[]; loaded: boolean; error: string };
const EMPTY_FEED: FeedSnapshot = { items: [], loaded: false, error: "" };
const GUEST_FEED: FeedSnapshot = { items: [], loaded: true, error: "" };
const serverSnapshot = () => EMPTY_FEED;

type FeedStore = {
  items: CoupleActivity[];
  dismissed: Set<string>;
  loaded: boolean;
  error: string;
  names: Map<string, string>;
  listeners: Set<() => void>;
  stop: (() => void) | null;
  invalidate: () => void;
  retry: () => void;
  snapshot: FeedSnapshot;
};

const feeds = new Map<string, FeedStore>();

function visibleFeedItems(store: Pick<FeedStore, "items" | "dismissed"> | undefined) {
  if (!store) return [] as CoupleActivity[];
  return withoutDismissedActivities(store.items, store.dismissed);
}

function notifyFeed(store: FeedStore) {
  store.snapshot = { items: visibleFeedItems(store), loaded: store.loaded, error: store.error };
  store.listeners.forEach(listener => listener());
}

function applyIncoming(store: FeedStore, incoming: CoupleActivity[]) {
  store.items = incoming;
  // Once a scoped read confirms a deletion/hide, release its optimistic ID.
  // Stored stories can legitimately be updated under the same ID later.
  const incomingIds = new Set(incoming.map(item => item.id));
  store.dismissed = new Set([...store.dismissed].filter(id => incomingIds.has(id)));
  store.loaded = true;
  store.error = "";
  notifyFeed(store);
}

export function hideCoupleActivitiesInFeed(ids: string[], scope?: string) {
  const hidden: Array<{ key: string; store: FeedStore }> = [];
  for (const [key, store] of feeds) {
    if (scope && key !== scope) continue;
    store.invalidate();
    store.dismissed = rememberDismissedIds(store.dismissed, ids);
    hidden.push({ key, store });
    notifyFeed(store);
  }
  return () => {
    for (const { key, store } of hidden) {
      if (feeds.get(key) !== store) continue;
      store.dismissed = forgetDismissedIds(store.dismissed, ids);
      notifyFeed(store);
    }
  };
}

export function restoreCoupleActivitiesInFeed(ids: string[], scope?: string) {
  for (const [key, store] of feeds) {
    if (scope && key !== scope) continue;
    store.dismissed = forgetDismissedIds(store.dismissed, ids);
    notifyFeed(store);
  }
}

function ensureFeed(coupleId: string, userId: string, names: Map<string, string>) {
  const scope = `${userId}:${coupleId}`;
  let store = feeds.get(scope);
  if (store) return store;

  store = { items: [], dismissed: new Set(), loaded: false, error: "", names, listeners: new Set(), stop: null, invalidate: () => {}, retry: () => {}, snapshot: EMPTY_FEED };
  feeds.set(scope, store);

  let cancelled = false;
  const guard = createReadGuard(scope);
  let request: AbortController | undefined;
  let lastRead = 0;

  const reload = async () => {
    const isCurrent = guard.capture();
    const controller = new AbortController();
    request = controller;
    await fetchCoupleActivitiesLive(coupleId, FEED_LIMIT, { names: store!.names, signal: controller.signal }).then(next => {
      if (cancelled || !isCurrent()) return;
      lastRead = Date.now();
      applyIncoming(store!, next);
    }).catch(() => {
      if (cancelled || !isCurrent()) return;
      store!.error = "이야기를 불러오지 못했어요.";
      store!.loaded = true;
      notifyFeed(store!);
    }).finally(() => {
      if (request === controller) request = undefined;
    });
  };

  const queue = createRefreshQueue(reload, { canRun: () => document.visibilityState === "visible", debounceMs: 160 });
  const invalidate = () => { guard.invalidate(); request?.abort(); };
  const scheduleReload = () => { invalidate(); queue.schedule(); };
  store.invalidate = invalidate;
  store.retry = scheduleReload;
  const live = subscribeCoupleActivities(coupleId, change => {
    if (change.source === "poll" && Date.now() - lastRead < 60_000) return;
    scheduleReload();
  }, userId);
  void queue.run();

  store.stop = () => {
    cancelled = true;
    invalidate();
    queue.stop();
    live.unsubscribe();
  };

  return store;
}

export function useCoupleActivityFeed(limit = FEED_LIMIT) {
  const session = useAppSession();
  const coupleId = session.mode === "authenticated" ? session.coupleId : "";
  const userId = session.mode === "authenticated" ? session.userId : "";
  const scope = coupleId ? `${userId}:${coupleId}` : "";
  const displayName = session.mode === "authenticated" ? session.displayName : "";
  const partnerId = session.mode === "authenticated" ? session.partner?.userId : undefined;
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName : undefined;
  const names = useMemo(() => {
    const result = new Map<string, string>();
    if (userId) result.set(userId, displayName || "나");
    if (partnerId) result.set(partnerId, partnerName || "파트너");
    return result;
  }, [userId, displayName, partnerId, partnerName]);
  const subscribe = useCallback((onChange: () => void) => {
    if (!coupleId) return () => {};
    const store = ensureFeed(coupleId, userId, names);
    store.listeners.add(onChange);
    return () => {
      store.listeners.delete(onChange);
      if (store.listeners.size > 0) return;
      store.stop?.();
      if (feeds.get(scope) === store) feeds.delete(scope);
    };
  }, [coupleId, userId, scope, names]);
  const getSnapshot = useCallback(() => coupleId ? feeds.get(scope)?.snapshot ?? EMPTY_FEED : GUEST_FEED, [coupleId, scope]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);

  useEffect(() => {
    const store = feeds.get(scope);
    if (!store) return;
    store.names = names;
    store.items = store.items.map(item => item.actorUserId && names.has(item.actorUserId)
      ? { ...item, actorName: names.get(item.actorUserId)! } : item);
    notifyFeed(store);
  }, [scope, names]);
  const retry = useCallback(() => feeds.get(scope)?.retry(), [scope]);

  return {
    items: snapshot.items.slice(0, limit),
    loaded: snapshot.loaded,
    error: snapshot.error,
    scope,
    retry,
  };
}
