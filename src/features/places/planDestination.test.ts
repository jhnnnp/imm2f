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
it.each(["-1", "7", "NaN", "1.5", "", null])("bounds the trip day %s", day => {
  expect(placePlanDestination("trip", "trip", day).dayIndex).toBe(0);
});
