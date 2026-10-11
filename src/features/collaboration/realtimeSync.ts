"use client";

import { createClient } from "@/lib/supabase/client";
import { COUPLE_ACTIVITIES_CHANGED } from "./activityClient";

export type WorkspaceChange =
  | { source: "database"; table: string; eventType: string; row: Record<string, unknown> }
  | { source: "local" | "resume" | "poll" | "reconnect" | "connect" };

type Listener = (change: WorkspaceChange) => void;
type SharedSync = {
  listeners: Set<Listener>;
  connected: Promise<boolean>;
  stop: () => void;
};
const active = new Map<string, SharedSync>();
// These tables are explicitly enabled in the repository's Realtime publication.
// Domain writes announce themselves through activities; resume/poll repairs any
// missed event without subscribing to unpublished or unscoped child tables.
const COUPLE_TABLES = ["activities", "memory_wall_boards", "couple_folders", "couple_folder_items", "trip_drafts"];

/** Share one realtime channel and one set of browser listeners per couple. */
export function subscribeWorkspaceChanges(coupleId: string, listener: Listener, options: { refreshOnConnect?: boolean } = {}) {
  const client = createClient();
  if (!client || !coupleId) return { unsubscribe() {}, connected: Promise.resolve(false) };
  let shared = active.get(coupleId);
  if (!shared) {
    const listeners = new Set<Listener>();
    let stopped = false;
    const notify = (change: WorkspaceChange) => {
      if (stopped) return;
      for (const callback of listeners) {
        try { callback(change); } catch { /* One screen must not block the other subscribers. */ }
      }
    };
    let resolveConnected: (connected: boolean) => void = () => {};
    const connected = new Promise<boolean>(resolve => { resolveConnected = resolve; });
    const connectionTimeout = window.setTimeout(() => resolveConnected(false), 5_000);
    const channel = client.channel(`workspace-sync:${coupleId}`);
    for (const table of COUPLE_TABLES) {
      channel.on("postgres_changes", {
        event: "*", schema: "public", table,
        filter: `couple_id=eq.${coupleId}`,
      }, payload => {
        const row = ((payload.eventType === "DELETE" ? payload.old : payload.new) ?? {}) as Record<string, unknown>;
        // DELETE does not run SELECT RLS and older deployments may only send
        // the primary key. Redact unscoped deletes; listeners perform a scoped
        // read to discover whether their own data changed.
        if (payload.eventType === "DELETE" && !row.couple_id) {
          notify({ source: "database", table, eventType: "DELETE", row: {} });
          return;
        }
        if (row.couple_id !== coupleId) return;
        notify({ source: "database", table, eventType: payload.eventType, row });
      });
    }
    let subscribed = false;
    channel.subscribe(status => {
      if (stopped) return;
      if (status === "SUBSCRIBED") {
        clearTimeout(connectionTimeout);
        resolveConnected(true);
        notify({ source: subscribed ? "reconnect" : "connect" });
        subscribed = true;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(connectionTimeout);
        resolveConnected(false);
      }
    });
    const local = () => notify({ source: "local" });
    let lastResume = -Infinity;
    const resume = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastResume < 300) return;
      lastResume = Date.now();
      notify({ source: "resume" });
    };
    window.addEventListener(COUPLE_ACTIVITIES_CHANGED, local);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") notify({ source: "poll" });
    }, 30_000);
    shared = {
      listeners, connected,
      stop() {
        stopped = true;
        resolveConnected(false);
        clearTimeout(connectionTimeout);
        clearInterval(poll);
        window.removeEventListener(COUPLE_ACTIVITIES_CHANGED, local);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", resume);
        void client.removeChannel(channel);
      },
    };
    active.set(coupleId, shared);
  }
  // Separate registrations remain independent even when callbacks are equal.
  let needsInitialRefresh = options.refreshOnConnect === true;
  const registered: Listener = change => {
    if (change.source === "connect") {
      if (needsInitialRefresh) { needsInitialRefresh = false; listener({ source: "reconnect" }); }
      return;
    }
    listener(change);
  };
  shared.listeners.add(registered);
  const current = shared;
  let released = false;
  // The session/side panel may have connected before this page finished loading.
  // Cover late consumers without replaying connect to every existing screen.
  if (needsInitialRefresh) void current.connected.then(ready => {
    if (ready && !released && needsInitialRefresh) { needsInitialRefresh = false; listener({ source: "reconnect" }); }
  });
  return {
    connected: current.connected,
    unsubscribe() {
      if (released) return;
      released = true;
      current.listeners.delete(registered);
      if (current.listeners.size) return;
      current.stop();
      if (active.get(coupleId) === current) active.delete(coupleId);
    },
  };
}
