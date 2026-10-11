import { expect, it } from "vitest";
import { isRelevantWorkspaceChange } from "./workspaceChange";

it("does not refetch an unrelated planner after each shared wall stroke", () => {
  expect(isRelevantWorkspaceChange({ source: "database", table: "memory_wall_boards", eventType: "UPDATE", row: {} }, {})).toBe(false);
  expect(isRelevantWorkspaceChange({ source: "database", table: "activities", eventType: "UPDATE", row: { action: "TRIP_UPDATED" } }, {})).toBe(true);
});
it("refreshes matching domain events and ignores unrelated known actions", () => {
  const options = { tables: ["memories", "places"], activityPrefixes: ["MEMORY_", "PLACE_"] };
  expect(isRelevantWorkspaceChange({ source: "database", table: "activities", eventType: "INSERT", row: { action: "MEMORY_CREATED" } }, options)).toBe(true);
  expect(isRelevantWorkspaceChange({ source: "database", table: "activities", eventType: "INSERT", row: { action: "TRIP_UPDATED" } }, options)).toBe(false);
});
it("conservatively repairs deleted or older activity rows without action metadata", () => {
  expect(isRelevantWorkspaceChange({ source: "database", table: "activities", eventType: "DELETE", row: {} }, { tables: ["places"], activityPrefixes: ["PLACE_"] })).toBe(true);
});
it("always repairs resumed, reconnected and manually announced changes", () => {
  for (const source of ["resume", "reconnect", "poll", "local"] as const) expect(isRelevantWorkspaceChange({ source }, { tables: ["places"], activityPrefixes: ["PLACE_"] })).toBe(true);
});
it("applies activity filters even when the activities table is explicitly requested", () => {
  const unrelated = { source: "database" as const, table: "activities", eventType: "INSERT", row: { action: "GIFT_CREATED" } };
  expect(isRelevantWorkspaceChange(unrelated, { tables: ["activities"], activityPrefixes: ["TRIP_"] })).toBe(false);
  expect(isRelevantWorkspaceChange(unrelated, { activityPrefixes: ["TRIP_"] })).toBe(false);
});
