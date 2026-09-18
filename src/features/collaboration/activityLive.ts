"use client";

import { useEffect, useState } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createClient } from "@/lib/supabase/client";
import { COUPLE_ACTIVITIES_CHANGED } from "./activityClient";
import { mapActivityRows, type ActivityRecord } from "./activityMap";
import type { CoupleActivity } from "./types";

const FEED_LIMIT = 20;

async function loadNames(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const supabase = createClient();
  if (!supabase) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map(row => [row.id, row.display_name || "파트너"]));
}

export async function fetchCoupleActivitiesLive(coupleId: string, limit = FEED_LIMIT): Promise<CoupleActivity[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("activities")
    .select("id, action, title, detail, actor_user_id, created_at")
    .eq("couple_id", coupleId)
    .neq("entity_type", "date_draft")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as ActivityRecord[];
  const names = await loadNames(rows.flatMap(row => row.actor_user_id ? [row.actor_user_id] : []));
  return mapActivityRows(rows, names);
}

type SharedLive = {
  count: number;
  listeners: Set<() => void>;
  connected: Promise<boolean>;
  stop: () => void;
};

const liveByCouple = new Map<string, SharedLive>();

export function subscribeCoupleActivities(coupleId: string, onChange: () => void) {
  const supabase = createClient();
  if (!supabase) return { unsubscribe: () => {}, connected: Promise.resolve(false) };

  let shared = liveByCouple.get(coupleId);
  if (!shared) {
    const listeners = new Set<() => void>();
    const notify = () => {
      listeners.forEach(listener => listener());
    };
    let subscribed = false;
    const channel = supabase
      .channel(`couple-activities:${coupleId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activities", filter: `couple_id=eq.${coupleId}` },
        notify,
      )
      .subscribe(status => {
        subscribed = status === "SUBSCRIBED";
      });
    shared = {
      count: 0,
      listeners,
      connected: new Promise<boolean>(resolve => {
        window.setTimeout(() => resolve(subscribed), 1200);
      }),
      stop() {
        void supabase.removeChannel(channel);
      },
    };
    liveByCouple.set(coupleId, shared);
  }

  shared.listeners.add(onChange);
  shared.count += 1;
  const current = shared;
  return {
    unsubscribe() {
      current.listeners.delete(onChange);
      current.count -= 1;
      if (current.count > 0) return;
      current.stop();
      if (liveByCouple.get(coupleId) === current) liveByCouple.delete(coupleId);
    },
    connected: current.connected,
  };
}

type FeedStore = {
  items: CoupleActivity[];
  loaded: boolean;
  error: string;
  listeners: Set<() => void>;
  stop: (() => void) | null;
};

const feeds = new Map<string, FeedStore>();

function notifyFeed(store: FeedStore) {
  store.listeners.forEach(listener => listener());
}

function ensureFeed(coupleId: string) {
  let store = feeds.get(coupleId);
  if (store) return store;

  store = { items: [], loaded: false, error: "", listeners: new Set(), stop: null };
  feeds.set(coupleId, store);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let poll: number | undefined;
  let cancelled = false;

  const reload = () => {
    void fetchCoupleActivitiesLive(coupleId, FEED_LIMIT).then(next => {
      if (cancelled) return;
      store!.items = next;
      store!.loaded = true;
      store!.error = "";
      notifyFeed(store!);
    }).catch(() => {
      if (cancelled) return;
      store!.error = "이야기를 불러오지 못했어요.";
      store!.loaded = true;
      notifyFeed(store!);
    });
  };

  const scheduleReload = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(reload, 160);
  };

  reload();
  window.addEventListener(COUPLE_ACTIVITIES_CHANGED, scheduleReload);
  const onVisible = () => {
    if (document.visibilityState === "visible") scheduleReload();
  };
  document.addEventListener("visibilitychange", onVisible);
  const live = subscribeCoupleActivities(coupleId, scheduleReload);
  void live.connected.then(() => {
    if (cancelled) return;
    poll = window.setInterval(scheduleReload, 4000);
  });

  store.stop = () => {
    cancelled = true;
    if (debounce) clearTimeout(debounce);
    if (poll) clearInterval(poll);
    window.removeEventListener(COUPLE_ACTIVITIES_CHANGED, scheduleReload);
    document.removeEventListener("visibilitychange", onVisible);
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
    items: (store?.items ?? []).slice(0, limit),
    loaded: store?.loaded ?? false,
    error: store?.error ?? "",
  };
}
