import { describe, expect, it } from "vitest";
import { isIsoDate, seoulTodayIso } from "./dates";

describe("calendar date input", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "2026-1-01", "2026-01-32", "not-a-date", "", null, undefined])("rejects invalid day %s", value => {
    expect(isIsoDate(value)).toBe(false);
  });
  it("accepts real dates including a leap day", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-10-11")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
  });
  it("uses the Seoul calendar date across UTC midnight", () => {
    expect(seoulTodayIso(new Date("2026-10-10T16:00:00Z"))).toBe("2026-10-11");
  });
});
