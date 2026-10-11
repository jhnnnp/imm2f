"use client";

import { useEffect, useState } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createClient } from "@/lib/supabase/client";
import { mapActivityRows, type ActivityRecord } from "./activityMap";
import { forgetDismissedIds, rememberDismissedIds, withoutDismissedActivities } from "./activityFeed";
import type { CoupleActivity } from "./types";
import { createRefreshQueue } from "./refreshQueue";
import { subscribeWorkspaceChanges } from "./realtimeSync";
import { createReadGuard } from "./readGuard";

const FEED_LIMIT = 20;

async function loadNames(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const supabase = createClient();
  if (!supabase) return new Map<string, string>();
  const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  if (error) throw new Error("이야기의 이름을 불러오지 못했어요.");
  return new Map((data ?? []).map(row => [row.id, row.display_name || "파트너"]));
}

export async function fetchCoupleActivitiesLive(coupleId: string, limit = FEED_LIMIT): Promise<CoupleActivity[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("activities")
    .select("id, action, title, detail, actor_user_id, created_at")
    .eq("couple_id", coupleId)
    .neq("entity_type", "date_draft")
    .neq("title", "")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("이야기를 불러오지 못했어요.");
  const rows = (data ?? []) as ActivityRecord[];
  const names = await loadNames(rows.flatMap(row => row.actor_user_id ? [row.actor_user_id] : []));
  return mapActivityRows(rows, names);
}

export function subscribeCoupleActivities(coupleId: string, onChange: () => void) {
  return subscribeWorkspaceChanges(coupleId, change => {
    if (change.source !== "database" || change.table === "activities") onChange();
  });
}

type FeedStore = {
  items: CoupleActivity[];
  dismissed: Set<string>;
  loaded: boolean;
  error: string;
  listeners: Set<() => void>;
  stop: (() => void) | null;
};

const feeds = new Map<string, FeedStore>();
const dismissedByCouple = new Map<string, Set<string>>();

function dismissedSet(coupleId: string) {
  let dismissed = dismissedByCouple.get(coupleId);
  if (!dismissed) {
    dismissed = new Set();
    dismissedByCouple.set(coupleId, dismissed);
  }
  return dismissed;
}

function visibleFeedItems(store: Pick<FeedStore, "items" | "dismissed"> | undefined) {
  if (!store) return [] as CoupleActivity[];
  return withoutDismissedActivities(store.items, store.dismissed);
}

function notifyFeed(store: FeedStore) {
  store.listeners.forEach(listener => listener());
}

function applyIncoming(store: FeedStore, incoming: CoupleActivity[]) {
  store.items = incoming;
  store.loaded = true;
  store.error = "";
  notifyFeed(store);
}

export function hideCoupleActivitiesInFeed(ids: string[]) {
  for (const [coupleId, store] of feeds) {
    store.dismissed = rememberDismissedIds(store.dismissed, ids);
    dismissedByCouple.set(coupleId, store.dismissed);
    notifyFeed(store);
  }
}

export function restoreCoupleActivitiesInFeed(ids: string[]) {
  for (const [coupleId, store] of feeds) {
    store.dismissed = forgetDismissedIds(store.dismissed, ids);
    dismissedByCouple.set(coupleId, store.dismissed);
    notifyFeed(store);
  }
}

function ensureFeed(coupleId: string) {
  let store = feeds.get(coupleId);
  if (store) return store;

  store = { items: [], dismissed: dismissedSet(coupleId), loaded: false, error: "", listeners: new Set(), stop: null };
  feeds.set(coupleId, store);

  let cancelled = false;
  const guard = createReadGuard(coupleId);

  const reload = async () => {
    const isCurrent = guard.capture();
    await fetchCoupleActivitiesLive(coupleId, FEED_LIMIT).then(next => {
      if (cancelled || !isCurrent()) return;
      applyIncoming(store!, next);
    }).catch(() => {
      if (cancelled || !isCurrent()) return;
      store!.error = "이야기를 불러오지 못했어요.";
      store!.loaded = true;
      notifyFeed(store!);
    });
  };

  const queue = createRefreshQueue(reload, { canRun: () => document.visibilityState === "visible", debounceMs: 160 });
  const scheduleReload = () => { guard.invalidate(); queue.schedule(); };
  void queue.run();
  const live = subscribeCoupleActivities(coupleId, scheduleReload);

  store.stop = () => {
    cancelled = true;
    guard.invalidate();
    queue.stop();
    live.unsubscribe();
  };

  return store;
}

export function useCoupleActivityFeed(limit = FEED_LIMIT) {
  const session = useAppSession();
  const coupleId = session.mode === "authenticated" ? session.coupleId : "";
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!coupleId) return;
    const store = ensureFeed(coupleId);
    const onChange = () => setTick(value => value + 1);
    store.listeners.add(onChange);
    setTick(value => value + 1);
    return () => {
      store.listeners.delete(onChange);
      if (store.listeners.size > 0) return;
      store.stop?.();
      if (feeds.get(coupleId) === store) feeds.delete(coupleId);
    };
  }, [coupleId]);

  if (!coupleId) return { items: [] as CoupleActivity[], loaded: true, error: "" };
  const store = feeds.get(coupleId);
  return {
    items: visibleFeedItems(store).slice(0, limit),
    loaded: store?.loaded ?? false,
    error: store?.error ?? "",
  };
}
