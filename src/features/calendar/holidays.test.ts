import { expect, it, vi } from "vitest";
import { createHolidayService, parseHolidayApi, parseKasiCalendar } from "./holidays";

function calendarHtml(year = 2026, extra = "", before = "") {
  return `<h2 class="boardlist_tit">${year}년 달력자료</h2>${before}<h2 class="h4_title">국경일과 공휴일</h2><div><table><tbody>
    <tr><td>1월 1일</td><td>1월 1일 (목)</td><td>광복절*</td><td>8월 15일 (토)</td></tr>
    <tr><td>설날</td><td>2월16일~ 2월18일 (월,화,수)</td><td>대체공휴일(광복절)</td><td>8월 17일 (월)</td></tr>
    <tr><td>3.1절*</td><td>3월 1일 (일)</td><td>추석</td><td>9월24일~ 9월26일 (목,금,토)</td></tr>
    <tr><td>대체공휴일(3.1절)</td><td>3월 2일 (월)</td><td>개천절*</td><td>10월 3일 (토)</td></tr>
    <tr><td>어린이날</td><td>5월 5일 (화)</td><td>대체공휴일(개천절)</td><td>10월 5일 (월)</td></tr>
    <tr><td>부처님오신날</td><td>5월 24일 (일)</td><td>한글날*</td><td>10월 9일 (금)</td></tr>
    <tr><td>대체공휴일(부처님오신날)</td><td>5월 25일 (월)</td><td>기독탄신일</td><td>12월 25일 (금)</td></tr>
    <tr><td>전국동시지방선거</td><td>6월 3일 (수)</td><td>현충일</td><td>6월 6일 (토)</td></tr>${extra}</tbody></table></div>
    <h2>기념일</h2><table><tr><td>밸런타인데이</td><td>2월 14일</td><td></td><td></td></tr></table>`;
}
const apiRows = (year = 2026) => ["0101", "0216", "0217", "0218", "0301", "0302", "0505", "0524", "0525", "0606", "0815", "1010", "1225"]
  .map((date, index) => ({ locdate: `${year}${date}`, dateName: `공휴일 ${index}`, isHoliday: "Y" }));
const apiBody = (rows: unknown[]) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: rows.length, items: { item: rows } } } });

it("expands lunar holiday ranges and preserves substitute/election/temporary dates from the source", () => {
  const result = parseKasiCalendar(calendarHtml(2026, "<tr><td>임시공휴일</td><td>10월 2일</td><td></td><td></td></tr>"), 2026);
  expect(result).toContainEqual({ date: "2026-02-16", name: "설날" });
  expect(result).toContainEqual({ date: "2026-02-18", name: "설날" });
  expect(result).toContainEqual({ date: "2026-10-05", name: "대체공휴일(개천절)" });
  expect(result).toContainEqual({ date: "2026-06-03", name: "전국동시지방선거" });
  expect(result).toContainEqual({ date: "2026-10-02", name: "임시공휴일" });
  expect(result.some(day => day.date === "2026-02-14")).toBe(false);
});
it("omits commemorative non-holidays and national days marked with two stars", () => {
  const html = calendarHtml(2026, "<tr><td>제헌절<span>**</span></td><td>7월 17일</td><td></td><td></td></tr>");
  expect(parseKasiCalendar(html, 2026).some(day => day.date === "2026-07-17")).toBe(false);
});
it("handles published holiday ranges crossing the end of January", () => {
  const html = calendarHtml(2022).replace("2월16일~ 2월18일", "1월31일 2월~2일");
  const holidays = parseKasiCalendar(html, 2022);
  expect(holidays).toContainEqual({ date: "2022-01-31", name: "설날" });
  expect(holidays).toContainEqual({ date: "2022-02-02", name: "설날" });
});
it("rejects an unpublished year silently replaced by the provider's default year", () => {
  expect(() => parseKasiCalendar(calendarHtml(2026), 2030)).toThrow("wrong_year");
});
it("rejects a partial annual calendar, invalid dates, or an unexpected table shape", () => {
  expect(() => parseKasiCalendar('<h2 class="boardlist_tit">2030년 달력자료</h2><h2>국경일과 공휴일</h2><table><tr><td>1월 1일</td><td>1월 1일</td><td></td><td></td></tr></table>', 2030)).toThrow("incomplete");
  expect(() => parseKasiCalendar(calendarHtml().replace("5월 5일", "2월 30일"), 2026)).toThrow("invalid_date");
  expect(() => parseKasiCalendar(calendarHtml().replace('<td>1월 1일</td><td>1월 1일 (목)</td>', '<td>1월 1일</td>'), 2026)).toThrow("changed_table");
});
it("accepts API JSON and XML, keeps only actual holidays and deduplicates overlapping names", () => {
  const rows = [...apiRows(), apiRows()[0], { locdate: "20260214", dateName: "기념일", isHoliday: "N" }];
  const json = parseHolidayApi(apiBody(rows), 2026);
  expect(json).toHaveLength(13);
  const xml = `<response><header><resultCode>00</resultCode></header><body><totalCount>13</totalCount><items>${apiRows().map(row => `<item><locdate>${row.locdate}</locdate><dateName>${row.dateName}</dateName><isHoliday>Y</isHoliday></item>`).join("")}</items></body></response>`;
  expect(parseHolidayApi(xml, 2026)).toEqual(json);
});
it("rejects provider errors, truncated pages and partial future API years", () => {
  expect(() => parseHolidayApi('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"30"}}}', 2026)).toThrow("rejected");
  expect(() => parseHolidayApi(apiBody(apiRows()).replace('"totalCount":13', '"totalCount":14'), 2026)).toThrow("incomplete");
  expect(() => parseHolidayApi(apiBody([apiRows(2030)[0]]), 2030)).toThrow("incomplete_year");
});
it("needs no key for the public KASI source and caches only the requested year", async () => {
  const fetcher = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(calendarHtml()));
  const load = createHolidayService({ fetcher, serviceKey: () => undefined });
  expect((await load(2026)).status).toBe("live");
  expect((await load(2026)).status).toBe("cached");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain("search_year=2026");
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: "text/html" });
});
it("falls back when a configured API rejects and never sends the key to the public page", async () => {
  const fetcher = vi.fn(async (url: string | URL) => String(url).includes("apis.data.go.kr") ? new Response("denied", { status: 403 }) : new Response(calendarHtml()));
  const result = await createHolidayService({ fetcher, serviceKey: () => "private%2Bkey" })(2026);
  expect(result.status).toBe("live");
  expect(result.source).toContain("astro.kasi.re.kr");
  expect(String(fetcher.mock.calls[1][0])).not.toContain("key");
  expect(JSON.stringify(result)).not.toContain("private");
});
it("coalesces simultaneous year reads without caching the unavailable response", async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
  const load = createHolidayService({ fetcher, serviceKey: () => undefined });
  const first = load(2026); const second = load(2026);
  release(new Response("offline", { status: 503 }));
  expect((await first).status).toBe("unavailable");
  expect(await second).toEqual(await first);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const retry = load(2026); release(new Response(calendarHtml()));
  expect((await retry).status).toBe("live");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("retains the last verified year during a short outage and expires old data", async () => {
  let clock = 0;
  const fetcher = vi.fn(async () => new Response(calendarHtml()));
  const load = createHolidayService({ fetcher, now: () => clock, serviceKey: () => undefined });
  await load(2026);
  clock = 7 * 60 * 60 * 1000;
  fetcher.mockRejectedValue(new Error("offline"));
  const stale = await load(2026);
  expect(stale.status).toBe("cached"); expect(stale.holidays.length).toBeGreaterThan(10);
  expect(stale.message).toContain("마지막으로");
  clock = 8 * 24 * 60 * 60 * 1000;
  expect((await load(2026)).status).toBe("unavailable");
});
it("rejects unsupported years before making a network request", async () => {
  const fetcher = vi.fn();
  const load = createHolidayService({ fetcher });
  expect((await load(2026.5)).status).toBe("unavailable");
  expect((await load(2101)).status).toBe("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
