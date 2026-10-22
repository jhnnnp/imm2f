import { expect, it } from "vitest";
import { keyDateEvents } from "./keyDateEvents";

it("repeats both birthdays and the anniversary in the displayed year without writing duplicate events", () => {
  const events = keyDateEvents({ relationshipStartedOn: "2024-10-22", birthdays: [
    { id: "one", name: "진한", date: "1998-05-01" }, { id: "two", name: "현정", date: "1999-12-31" },
  ] }, 2026);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ date: "2026-05-01", title: "진한의 생일" }),
    expect.objectContaining({ date: "2026-12-31", title: "현정의 생일" }),
    expect.objectContaining({ date: "2026-10-22", title: "우리의 2주년" }),
  ]));
  expect(new Set(events.map(event => event.id)).size).toBe(events.length);
});
it("counts the first day as day one for 100-day milestones across year boundaries", () => {
  const events = keyDateEvents({ relationshipStartedOn: "2025-12-01", birthdays: [] }, 2026);
  expect(events.find(event => event.id === "milestone:100")?.date).toBe("2026-03-10");
  expect(events.find(event => event.id === "milestone:200")?.date).toBe("2026-06-18");
});
it("handles leap day birthdays explicitly in common and leap years", () => {
  const input = { relationshipStartedOn: "2024-02-29", birthdays: [{ id: "leap", name: "우리", date: "2000-02-29" }] };
  expect(keyDateEvents(input, 2026).find(event => event.kind === "birthday")).toMatchObject({ date: "2026-02-28", detail: expect.stringContaining("평년") });
  expect(keyDateEvents(input, 2028).find(event => event.kind === "birthday")?.date).toBe("2028-02-29");
});
it("does not fabricate events for invalid, absent or future birth dates", () => {
  expect(keyDateEvents({ relationshipStartedOn: null, birthdays: [] }, 2026)).toEqual([]);
  expect(keyDateEvents({ relationshipStartedOn: "2027-01-01", birthdays: [{ id: "future", name: "나", date: "2027-01-01" }, { id: "bad", name: "나", date: "2026-02-31" }] }, 2026)).toEqual([]);
});
