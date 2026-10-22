import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeWorkspaceChanges } from "./realtimeSync";
import { COUPLE_ACTIVITIES_CHANGED } from "./activityClient";

type Payload = { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
type Registration = { filter: { table: string; event: string; filter?: string }; callback: (payload: Payload) => void };
const { channel, removeChannel, channels } = vi.hoisted(() => ({
  channel: vi.fn(), removeChannel: vi.fn(),
  channels: [] as Array<{ name: string; registrations: Registration[]; status: (status: string) => void }>,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ channel, removeChannel }) }));

const subscriptions: Array<{ unsubscribe: () => void }> = [];
let browser: EventTarget;
let page: EventTarget & { visibilityState: string };
function subscribe(coupleId: string, callback = vi.fn()) {
  const subscription = subscribeWorkspaceChanges(coupleId, callback);
  subscriptions.push(subscription);
  return { ...subscription, callback };
}
function emit(table: string, payload: Payload, index = 0) {
  channels[index].registrations.find(registration => registration.filter.table === table)!.callback(payload);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
  browser = Object.assign(new EventTarget(), { setTimeout, setInterval });
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", page);
  channels.length = 0;
  removeChannel.mockReset().mockResolvedValue("ok");
  channel.mockReset().mockImplementation((name: string) => {
    const entry = { name, registrations: [] as Registration[], status: (_status: string) => {} };
    channels.push(entry);
    const value = {
      on: vi.fn((_event, filter, callback) => { entry.registrations.push({ filter, callback }); return value; }),
      subscribe: vi.fn(callback => { entry.status = callback; return value; }),
    };
    return value;
  });
});
afterEach(() => {
  for (const subscription of subscriptions.splice(0)) subscription.unsubscribe();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("shares the activity, session and screen connection until their last release", () => {
  const first = subscribe("couple-a");
  const second = subscribe("couple-a");
  const third = subscribe("couple-a");
  expect(channel).toHaveBeenCalledTimes(1);
  emit("activities", { eventType: "INSERT", new: { couple_id: "couple-a", action: "PLACE_CREATED" } });
  expect(first.callback).toHaveBeenCalledTimes(1);
  expect(second.callback).toHaveBeenCalledTimes(1);
  expect(third.callback).toHaveBeenCalledTimes(1);
  first.unsubscribe(); first.unsubscribe(); second.unsubscribe();
  expect(removeChannel).not.toHaveBeenCalled();
  third.unsubscribe();
  expect(removeChannel).toHaveBeenCalledTimes(1);
});

it("keeps separate registrations of the same callback alive independently", () => {
  const callback = vi.fn();
  const first = subscribe("couple-a", callback);
  subscribe("couple-a", callback);
  first.unsubscribe();
  browser.dispatchEvent(new Event(COUPLE_ACTIVITIES_CHANGED));
  expect(callback).toHaveBeenCalledTimes(1);
  expect(removeChannel).not.toHaveBeenCalled();
});

it("subscribes only published tables with explicit couple filters", () => {
  subscribe("couple-a");
  expect(channels[0].registrations.map(({ filter }) => filter)).toEqual([
    { event: "*", schema: "public", table: "activities", filter: "couple_id=eq.couple-a" },
    { event: "*", schema: "public", table: "memory_wall_boards", filter: "couple_id=eq.couple-a" },
    { event: "*", schema: "public", table: "couple_folders", filter: "couple_id=eq.couple-a" },
    { event: "*", schema: "public", table: "couple_folder_items", filter: "couple_id=eq.couple-a" },
    { event: "*", schema: "public", table: "trip_drafts", filter: "couple_id=eq.couple-a" },
    { event: "*", schema: "public", table: "couple_key_dates", filter: "couple_id=eq.couple-a" },
  ]);
});

it("rejects rows from another couple and redacts unscoped deleted row data", () => {
  const subscription = subscribe("couple-a");
  emit("activities", { eventType: "UPDATE", new: { couple_id: "couple-b", action: "MEMORY_CREATED" } });
  emit("activities", { eventType: "DELETE", old: { couple_id: "couple-b", id: "private-id" } });
  expect(subscription.callback).not.toHaveBeenCalled();
  emit("activities", { eventType: "DELETE", old: { id: "private-id" } });
  expect(subscription.callback).toHaveBeenCalledWith({ source: "database", table: "activities", eventType: "DELETE", row: {} });
});

it("refreshes once when a suspended tab becomes visible and focused", () => {
  const subscription = subscribe("couple-a");
  page.visibilityState = "hidden";
  browser.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  expect(subscription.callback).not.toHaveBeenCalled();
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  browser.dispatchEvent(new Event("focus"));
  expect(subscription.callback).toHaveBeenCalledTimes(1);
  expect(subscription.callback).toHaveBeenCalledWith({ source: "resume" });
});

it("polls visible tabs and removes all browser listeners after the last release", async () => {
  const subscription = subscribe("couple-a");
  page.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(60_000);
  expect(subscription.callback).not.toHaveBeenCalled();
  page.visibilityState = "visible";
  await vi.advanceTimersByTimeAsync(30_000);
  expect(subscription.callback).toHaveBeenCalledExactlyOnceWith({ source: "poll" });
  subscription.unsubscribe();
  browser.dispatchEvent(new Event(COUPLE_ACTIVITIES_CHANGED));
  browser.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(subscription.callback).toHaveBeenCalledTimes(1);
});

it("repairs a reconnect without duplicating initial server reads", async () => {
  const subscription = subscribe("couple-a");
  channels[0].status("SUBSCRIBED");
  await expect(subscription.connected).resolves.toBe(true);
  expect(subscription.callback).not.toHaveBeenCalled();
  channels[0].status("CHANNEL_ERROR");
  channels[0].status("SUBSCRIBED");
  expect(subscription.callback).toHaveBeenCalledExactlyOnceWith({ source: "reconnect" });
});

it("repairs the server-snapshot to first-connection gap only for opted-in screens", async () => {
  const legacy = subscribe("couple-a");
  const callback = vi.fn();
  const folders = subscribeWorkspaceChanges("couple-a", callback, { refreshOnConnect: true });
  subscriptions.push(folders);
  channels[0].status("SUBSCRIBED");
  expect(legacy.callback).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledExactlyOnceWith({ source: "reconnect" });
  channels[0].status("CHANNEL_ERROR");
  channels[0].status("SUBSCRIBED");
  expect(callback).toHaveBeenCalledTimes(2);
  expect(legacy.callback).toHaveBeenCalledExactlyOnceWith({ source: "reconnect" });
});

it("refreshes a folder consumer joining an already connected shared channel once", async () => {
  subscribe("couple-a");
  channels[0].status("SUBSCRIBED");
  const callback = vi.fn();
  const folders = subscribeWorkspaceChanges("couple-a", callback, { refreshOnConnect: true });
  subscriptions.push(folders);
  await Promise.resolve();
  expect(callback).toHaveBeenCalledExactlyOnceWith({ source: "reconnect" });
});

it("settles connection waits when disposed and ignores late socket callbacks", async () => {
  const subscription = subscribe("couple-a");
  subscription.unsubscribe();
  await expect(subscription.connected).resolves.toBe(false);
  channels[0].status("SUBSCRIBED");
  emit("activities", { eventType: "INSERT", new: { couple_id: "couple-a" } });
  expect(subscription.callback).not.toHaveBeenCalled();
});

it("releases failed handshake waits while keeping fallback polling active", async () => {
  const subscription = subscribe("couple-a");
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(subscription.connected).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(subscription.callback).toHaveBeenCalledExactlyOnceWith({ source: "poll" });
});

it("isolates broken subscribers and shares local announcements", () => {
  subscribe("couple-a", vi.fn(() => { throw new Error("screen failed"); }));
  const subscription = subscribe("couple-a");
  browser.dispatchEvent(new Event(COUPLE_ACTIVITIES_CHANGED));
  expect(subscription.callback).toHaveBeenCalledExactlyOnceWith({ source: "local" });
});

it("replaces an old couple's socket without delivering its later changes", () => {
  const old = subscribe("couple-a");
  old.unsubscribe();
  const next = subscribe("couple-b");
  emit("activities", { eventType: "INSERT", new: { couple_id: "couple-a" } }, 0);
  expect(old.callback).not.toHaveBeenCalled();
  expect(next.callback).not.toHaveBeenCalled();
  emit("activities", { eventType: "INSERT", new: { couple_id: "couple-b" } }, 1);
  expect(next.callback).toHaveBeenCalledTimes(1);
});
