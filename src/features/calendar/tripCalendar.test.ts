import { expect, it } from "vitest";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import { calendarTrips, tripsOnDate } from "./tripCalendar";
const item: PlanItem = { id: "cafe", placeId: "cafe", placeName: "부산 카페", category: "카페", memo: "", dayIndex: 0, order: 0, startTime: "13:00", durationMinutes: 60, expectedCost: 0 };
const active: CouplePlan = { persist: true, revision: 2, startDate: "2026-12-01", title: "새 여행", notes: "", dayCount: 1, items: [item] };
const archive: ArchivedTripPlan = { id: "record", startDate: "2026-10-30", title: "부산 2박 3일", notes: "체크인 16시", dayCount: 3, status: "completed", items: [item, { ...item, id: "second", placeName: "둘째날 바다", dayIndex: 1 }, { ...item, id: "third", placeName: "셋째날 시장", dayIndex: 2 }] };
it("keeps all archived trip days visible after the active travel has changed", () => {
  const trips = calendarTrips(active, [], [archive]);
  expect(tripsOnDate(trips, "2026-10-30")[0]).toMatchObject({ day: 0, href: "/trip?archive=record&day=0", items: [item] });
  expect(tripsOnDate(trips, "2026-10-31")[0]).toMatchObject({ day: 1, href: "/trip?archive=record&day=1", items: [expect.objectContaining({ placeName: "둘째날 바다" })] });
  expect(tripsOnDate(trips, "2026-11-01")[0]).toMatchObject({ day: 2, href: "/trip?archive=record&day=2", items: [expect.objectContaining({ placeName: "셋째날 시장" })] });
  expect(tripsOnDate(trips, "2026-11-02")).toEqual([]);
});
it("reopens dated saved trips on the correct day rather than the active trip", () => {
  const trips = calendarTrips(active, [{ ...archive, startDate: "2026-11-10", notes: "" }], []);
  expect(tripsOnDate(trips, "2026-11-11")[0]).toMatchObject({ day: 1, href: "/trip?date=2026-11-10&day=1" });
});
it("shows an archive once when its identical active snapshot is still present", () => {
  const trips = calendarTrips({ ...active, ...archive, notes: archive.notes ?? "" }, [], [archive]);
  expect(tripsOnDate(trips, archive.startDate)).toHaveLength(1);
  expect(trips[0].archived).toBe(true);
});
it("keeps a modified draft alongside its archive without merging their places", () => {
  const trips = calendarTrips({ ...active, ...archive, notes: "수정된 메모" }, [], [archive]);
  expect(tripsOnDate(trips, archive.startDate)).toHaveLength(2);
  expect(new Set(trips.map(trip => trip.id)).size).toBe(2);
});
it("skips undated trips and invalid archive dates instead of inventing calendar dates", () => {
  expect(calendarTrips({ ...active, startDate: null }, [], [{ ...archive, startDate: "" }])).toEqual([]);
});
it("keeps overlapping trip records separate and orders each day's places", () => {
  const second = { ...archive, id: "another", items: [{ ...item, id: "later", order: 2 }, { ...item, id: "earlier", order: 1 }] };
  const trips = calendarTrips(active, [], [archive, second]);
  const matches = tripsOnDate(trips, archive.startDate);
  expect(matches).toHaveLength(2);
  expect(matches[1].items.map(row => row.id)).toEqual(["earlier", "later"]);
});
