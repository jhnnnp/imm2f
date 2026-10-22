import { describe, expect, it } from "vitest";
import { buildJourneyCalendar } from "./journeyCalendar";

describe("buildJourneyCalendar", () => {
  it("builds five Sunday-first weeks with the current trip and today marked separately", () => {
    const result = buildJourneyCalendar("2026-10-13", 3, "2026-10-22");
    expect(result.monthLabel).toBe("2026년 10월");
    expect(result.cells).toHaveLength(35);
    expect(result.cells[0]).toMatchObject({ iso: "2026-09-27", day: 27, outside: true });
    expect(result.cells.at(-1)?.iso).toBe("2026-10-31");
    expect(result.cells.filter(cell => cell.trip).map(cell => cell.iso))
      .toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(result.cells.find(cell => cell.start)?.iso).toBe("2026-10-13");
    expect(result.cells.find(cell => cell.today)?.iso).toBe("2026-10-22");
  });

  it("keeps all six weeks when the focus month needs them", () => {
    const result = buildJourneyCalendar("2026-08-30", 2, "2026-10-22");
    expect(result.cells).toHaveLength(42);
    expect(result.cells[0].iso).toBe("2026-07-26");
    expect(result.cells.at(-1)?.iso).toBe("2026-09-05");
  });

  it("retains an otherwise outside sixth week when a trip crosses the month boundary", () => {
    const result = buildJourneyCalendar("2026-10-31", 4, "2026-10-22");
    expect(result.cells).toHaveLength(42);
    expect(result.cells.filter(cell => cell.trip).map(cell => cell.iso))
      .toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(result.cells.find(cell => cell.iso === "2026-11-03"))
      .toMatchObject({ outside: true, trip: true, start: false });
  });

  it("retains correct ISO years for a trip crossing New Year", () => {
    const result = buildJourneyCalendar("2026-12-31", 4, "2027-01-01");
    expect(result.monthLabel).toBe("2026년 12월");
    expect(result.cells.filter(cell => cell.trip).map(cell => cell.iso))
      .toEqual(["2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(result.cells.find(cell => cell.today)).toMatchObject({ iso: "2027-01-01", outside: true, trip: true });
  });

  it("includes leap day and correctly continues into March", () => {
    const result = buildJourneyCalendar("2028-02-28", 3, "2028-02-29");
    expect(result.cells.filter(cell => cell.trip).map(cell => cell.iso))
      .toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(buildJourneyCalendar("2027-02-28", 2, "2027-02-28").cells.filter(cell => cell.trip).map(cell => cell.iso))
      .toEqual(["2027-02-28", "2027-03-01"]);
  });

  it("shows today's month without invented trip marks when no trip exists", () => {
    const result = buildJourneyCalendar(null, 3, "2026-10-22");
    expect(result.monthLabel).toBe("2026년 10월");
    expect(result.cells.some(cell => cell.trip || cell.start)).toBe(false);
    expect(result.cells.find(cell => cell.today)?.iso).toBe("2026-10-22");
    expect(buildJourneyCalendar("2026-10-22", 0, "2026-10-22").cells.some(cell => cell.start)).toBe(false);
  });

  it("limits long trips to the focus month's six-week window", () => {
    const result = buildJourneyCalendar("2026-10-31", 100, "2026-10-22");
    expect(result.cells).toHaveLength(42);
    expect(result.cells.at(-1)).toMatchObject({ iso: "2026-11-07", trip: true });
  });

  it("rejects impossible dates and avoids invalid numeric duration marks", () => {
    expect(buildJourneyCalendar(null, 3, "2026-02-30")).toEqual({ monthLabel: "", cells: [] });
    expect(buildJourneyCalendar("2026-02-30", 3, "2026-10-22").monthLabel).toBe("2026년 10월");
    expect(buildJourneyCalendar("2026-10-22", Infinity, "2026-10-22").cells.some(cell => cell.trip)).toBe(false);
  });

  it("returns identical cells across host timezones and DST boundaries", () => {
    const original = process.env.TZ;
    try {
      const results = ["UTC", "Asia/Seoul", "America/Los_Angeles", "Pacific/Kiritimati"].map(timezone => {
        process.env.TZ = timezone;
        return buildJourneyCalendar("2026-03-07", 4, "2026-03-08");
      });
      results.forEach(result => expect(result).toEqual(results[0]));
      expect(results[0].cells.filter(cell => cell.trip).map(cell => cell.iso))
        .toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
