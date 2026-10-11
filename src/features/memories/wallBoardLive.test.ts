import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceChange } from "@/features/collaboration/realtimeSync";
import { subscribeMemoryWallBoard } from "./wallBoardLive";
import { emptyBoardState } from "./corkLayout";

const live = vi.hoisted(() => ({ subscribe: vi.fn(), listener: (_change: WorkspaceChange) => {} }));
vi.mock("@/features/collaboration/realtimeSync", () => ({ subscribeWorkspaceChanges: live.subscribe }));
beforeEach(() => {
  live.subscribe.mockReset().mockImplementation((_couple, listener) => { live.listener = listener; return { unsubscribe: vi.fn(), connected: Promise.resolve(true) }; });
});

it("shares the workspace channel and applies complete wall state payloads", () => {
  const receive = vi.fn();
  const refresh = vi.fn();
  subscribeMemoryWallBoard("couple-a", receive, refresh);
  const state = emptyBoardState();
  live.listener({ source: "database", table: "memory_wall_boards", eventType: "UPDATE", row: { state, updated_at: "2026-10-11T12:00:00Z", updated_by: "partner" } });
  expect(receive).toHaveBeenCalledWith(state, "2026-10-11T12:00:00Z", "partner");
  expect(refresh).not.toHaveBeenCalled();
});

it("repairs missed wall events on resume, reconnect and shared polling", () => {
  const refresh = vi.fn();
  subscribeMemoryWallBoard("couple-a", vi.fn(), refresh);
  live.listener({ source: "resume" });
  live.listener({ source: "reconnect" });
  live.listener({ source: "poll" });
  expect(refresh).toHaveBeenCalledTimes(3);
});

it("ignores unrelated domain and local activity events but recovers incomplete wall events", () => {
  const receive = vi.fn();
  const refresh = vi.fn();
  subscribeMemoryWallBoard("couple-a", receive, refresh);
  live.listener({ source: "local" });
  live.listener({ source: "database", table: "activities", eventType: "INSERT", row: { action: "PLACE_CREATED" } });
  expect(refresh).not.toHaveBeenCalled();
  live.listener({ source: "database", table: "memory_wall_boards", eventType: "DELETE", row: {} });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(receive).not.toHaveBeenCalled();
});
