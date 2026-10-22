import { describe, expect, it } from "vitest";
import type { CoupleNote } from "@/features/lists/types";
import { chooseBucketWish, upcomingKeyDates } from "./homeMoments";

describe("upcomingKeyDates", () => {
  it("includes today's anniversary, drops past events and limits the next events to three", () => {
    const events = upcomingKeyDates({ relationshipStartedOn: "2024-10-22", birthdays: [
      { id: "past", name: "진한", date: "1990-10-21" },
      { id: "next", name: "현정", date: "1990-10-23" },
    ] }, "2026-10-22");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ title: "우리의 2주년", date: "2026-10-22", daysUntil: 0 });
    expect(events[1]).toMatchObject({ title: "현정의 생일", date: "2026-10-23", daysUntil: 1 });
    expect(events.every(event => event.date >= "2026-10-22")).toBe(true);
  });

  it("finds early next-year birthdays across December without timezone-dependent day counts", () => {
    expect(upcomingKeyDates({ relationshipStartedOn: null, birthdays: [
      { id: "one", name: "진한", date: "1990-01-01" },
    ] }, "2026-12-31")).toEqual([
      expect.objectContaining({ date: "2027-01-01", daysUntil: 1 }),
    ]);
  });

  it("uses February 28 for leap birthdays in common years and February 29 in leap years", () => {
    const dates = { relationshipStartedOn: null, birthdays: [{ id: "leap", name: "현정", date: "2000-02-29" }] };
    expect(upcomingKeyDates(dates, "2027-02-27")[0]).toMatchObject({ date: "2027-02-28", daysUntil: 1, detail: expect.stringContaining("평년") });
    expect(upcomingKeyDates(dates, "2028-02-28")[0]).toMatchObject({ date: "2028-02-29", daysUntil: 1 });
  });

  it("counts the first relationship day as day one for hundred-day milestones", () => {
    expect(upcomingKeyDates({ relationshipStartedOn: "2025-12-01", birthdays: [] }, "2026-03-09")[0])
      .toMatchObject({ id: "milestone:100", date: "2026-03-10", daysUntil: 1 });
  });

  it("keeps both partners' same-day birthdays and an anniversary with stable unique IDs", () => {
    const events = upcomingKeyDates({ relationshipStartedOn: "2024-05-01", birthdays: [
      { id: "one", name: "진한", date: "1990-05-01" },
      { id: "two", name: "현정", date: "1991-05-01" },
    ] }, "2026-05-01");
    expect(events.map(event => event.kind)).toEqual(["anniversary", "birthday", "birthday"]);
    expect(events.every(event => event.daysUntil === 0)).toBe(true);
    expect(new Set(events.map(event => event.id)).size).toBe(3);
  });

  it("returns no invented dates when settings are absent or today is invalid", () => {
    const empty = { relationshipStartedOn: null, birthdays: [] };
    expect(upcomingKeyDates(empty, "2026-10-22")).toEqual([]);
    expect(upcomingKeyDates(empty, "2026-02-30")).toEqual([]);
  });
});

const note = (id: string, status: string, kind: CoupleNote["kind"] = "bucket"): CoupleNote => ({
  id, kind, status, title: id, detail: "", extra: "", createdAt: "2026-10-22T00:00:00Z",
});

describe("chooseBucketWish", () => {
  it("prioritizes planning while preserving the saved order and original objects", () => {
    const notes = [note("first wish", "wish"), note("first plan", "planning"), note("next plan", "planning")];
    const original = [...notes];
    expect(chooseBucketWish(notes)).toBe(notes[1]);
    expect(notes).toEqual(original);
  });

  it("uses the first saved wish when there are no plans, ignoring other lists and completed wishes", () => {
    const notes = [note("gift", "planning", "gift"), note("done", "done"), note("wish", "wish"), note("later", "wish")];
    expect(chooseBucketWish(notes)).toBe(notes[2]);
  });

  it("returns null for empty, completed-only and unrecognized-status lists", () => {
    expect(chooseBucketWish([])).toBeNull();
    expect(chooseBucketWish([note("done", "done"), note("unknown", "archived")])).toBeNull();
  });
});
