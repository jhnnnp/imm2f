import { expect, it } from "vitest";
import { itemsForDay, movePlanItemToDay, replacePlanDay } from "./planOrder";
import type { PlanItem } from "./types/plan";
const stop = (id: string, order: number, dayIndex = 0): PlanItem => ({ id, placeId: id, placeName: id, order, dayIndex, startTime: `${10 + order}:00`, durationMinutes: 60, expectedCost: 0, memo: "", category: "카페" });

it("preserves a drag order even when scheduled times run in the opposite order", () => {
  const a = stop("a", 0), b = stop("b", 1), tomorrow = stop("tomorrow", 2, 1);
  const result = replacePlanDay([a, b, tomorrow], 0, [b, a]);
  expect(itemsForDay(result, 0).map(item => item.id)).toEqual(["b", "a"]);
  expect(itemsForDay(result, 1).map(item => item.id)).toEqual(["tomorrow"]);
});
it("changing a time keeps map pin order unchanged", () => {
  const items = [stop("a", 0), { ...stop("b", 1), startTime: "08:00" }];
  expect(itemsForDay(items, 0).map(item => item.id)).toEqual(["a", "b"]);
  expect(itemsForDay(items, 1)).toEqual([]);
});
it("moves a stop onto another day and appends it there", () => {
  const a = stop("a", 0);
  const b = stop("b", 1);
  const c = stop("c", 0, 1);
  const result = movePlanItemToDay([a, b, c], "b", 1);
  expect(itemsForDay(result, 0).map(item => item.id)).toEqual(["a"]);
  expect(itemsForDay(result, 1).map(item => item.id)).toEqual(["c", "b"]);
});
it("ignores moving a stop onto its current day", () => {
  const items = [stop("a", 0), stop("b", 1)];
  expect(movePlanItemToDay(items, "a", 0)).toBe(items);
});
