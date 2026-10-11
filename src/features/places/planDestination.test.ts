import { expect, it } from "vitest";
import { placePlanDestination } from "./planDestination";

it("adds to and returns to the explicit date rather than the globally active day", () => {
  expect(placePlanDestination("date", "date", "2026-10-18")).toEqual({
    href: "/date?day=2026-10-18", targetDate: "2026-10-18", dayIndex: 0,
  });
});
it.each(["2026-02-30", "2", "2026-10-18/other", "", null])("rejects invalid date context %s", day => {
  expect(placePlanDestination("date", "date", day).targetDate).toBeUndefined();
});
it("does not carry a trip day into a date or a date into a trip", () => {
  expect(placePlanDestination("date", "trip", "2").href).toBe("/date");
  expect(placePlanDestination("trip", "date", "2026-10-18").dayIndex).toBe(0);
});
it("preserves the selected trip day in the item and return link", () => {
  expect(placePlanDestination("trip", "trip", "2")).toMatchObject({ href: "/trip?day=2", dayIndex: 2 });
});
it("preserves an explicit dated trip rather than adding to a different active trip", () => {
  expect(placePlanDestination("trip", "trip", "2", "2026-10-18")).toEqual({
    href: "/trip?date=2026-10-18&day=2", targetDate: "2026-10-18", dayIndex: 2,
  });
});
it("keeps an explicit undated draft distinct from the missing active-trip context", () => {
  expect(placePlanDestination("trip", "trip", "1", "")).toEqual({ href: "/trip?date=&day=1", targetDate: "", dayIndex: 1 });
  expect(placePlanDestination("trip", "trip", "1", undefined)).toEqual({ href: "/trip?day=1", targetDate: undefined, dayIndex: 1 });
});
it.each(["2026-02-30", "garbage", "2026-10-18&day=6", null])("does not forward an invalid trip start date %s", tripDate => {
  expect(placePlanDestination("trip", "trip", "2", tripDate)).toEqual({ href: "/trip?day=2", targetDate: undefined, dayIndex: 2 });
});
it("does not carry a trip start date into an unrelated plan source", () => {
  expect(placePlanDestination("trip", "date", "2026-10-18", "2026-11-01")).toEqual({ href: "/trip?day=0", targetDate: undefined, dayIndex: 0 });
  expect(placePlanDestination("date", "trip", "2", "2026-11-01")).toEqual({ href: "/date", targetDate: undefined, dayIndex: 0 });
});
it.each(["-1", "7", "NaN", "1.5", "", null])("bounds the trip day %s", day => {
  expect(placePlanDestination("trip", "trip", day).dayIndex).toBe(0);
});
