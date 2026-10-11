import { describe, expect, it } from "vitest";
import { appendPlanItem } from "./appendPlanItem";
import type { PlanItem } from "./types/plan";

const stop: PlanItem = { id: "cafe", placeId: "place-1", placeName: "우리 카페", category: "카페", startTime: "13:00", durationMinutes: 60, expectedCost: 0, order: 0, memo: "", dayIndex: 0 };

describe("adding a stop to the selected day", () => {
  it("allows the same hotel on a different day with a unique ID and a fresh start time", () => {
    const current = { ...stop, startTime: "21:00" };
    const added = appendPlanItem([current], { ...stop, dayIndex: 1 }, "trip");
    expect(added.duplicate).toBe(false);
    expect(added.items[0]).toBe(current);
    expect(added.items[1]).toMatchObject({ dayIndex: 1, startTime: "13:00", placeId: stop.placeId });
    expect(new Set(added.items.map(item => item.id)).size).toBe(2);
  });

  it("continues only the selected day's last stop, rather than another day's evening", () => {
    const dayOne = { ...stop, id: "one", placeId: "one", startTime: "09:00", dayIndex: 0 };
    const dayTwo = { ...stop, id: "two", placeId: "two", startTime: "21:00", dayIndex: 1, order: 1 };
    const added = appendPlanItem([dayOne, dayTwo], { ...stop, placeId: "three", dayIndex: 0 }, "trip");
    expect(added.items.at(-1)?.startTime).toBe("10:20");
  });

  it("does not add a duplicate place to the same day", () => {
    const items = [stop];
    expect(appendPlanItem(items, { ...stop, id: "retry" }, "trip")).toEqual({ duplicate: true, items });
  });

  it("allows two branches with the same display name", () => {
    expect(appendPlanItem([stop], { ...stop, id: "branch", placeId: "place-2" }, "date").duplicate).toBe(false);
  });

  it("forces single-day date stops onto day zero", () => {
    expect(appendPlanItem([], { ...stop, dayIndex: 3 }, "date").items[0].dayIndex).toBe(0);
  });
  it("does not wrap a late stop into the morning of the same day", () => {
    const items = [{ ...stop, startTime: "23:30", durationMinutes: 60 }];
    const added = appendPlanItem(items, { ...stop, id: "next", placeId: "next" }, "date");
    expect(added.error).toContain("자정");
    expect(added.items).toBe(items);
  });
});
