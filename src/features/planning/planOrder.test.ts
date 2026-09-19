import { expect, it } from "vitest";
import { itemsForDay, replacePlanDay } from "./planOrder";
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
