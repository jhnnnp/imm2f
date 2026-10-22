import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/features/calendar/holidays", () => ({ loadKoreanHolidays: mocks.load, validHolidayYear: (year: number) => Number.isInteger(year) && year >= 1900 && year <= 2100 }));
import { GET } from "./route";
beforeEach(() => mocks.load.mockReset());
it.each(["", "2026.5", "2026junk", "2101", "1899"])("rejects invalid year %j without querying the holiday source", async value => {
  const response = await GET(new Request(`https://example.test/api/calendar/holidays?year=${value}`));
  expect(response.status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
});
it("returns public holiday metadata with bounded shared caching", async () => {
  const result = { holidays: [{ date: "2026-10-05", name: "대체공휴일" }], source: "https://astro.kasi.re.kr", status: "live" };
  mocks.load.mockResolvedValue(result);
  const response = await GET(new Request("https://example.test/api/calendar/holidays?year=2026"));
  expect(mocks.load).toHaveBeenCalledWith(2026); expect(await response.json()).toEqual(result);
  expect(response.headers.get("Cache-Control")).toContain("public");
});
it("does not cache an unavailable source as an empty normal calendar", async () => {
  mocks.load.mockResolvedValue({ holidays: [], source: "https://astro.kasi.re.kr", status: "unavailable", message: "다시 시도해 주세요" });
  const response = await GET(new Request("https://example.test/api/calendar/holidays?year=2030"));
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toHaveProperty("status", "unavailable");
});
