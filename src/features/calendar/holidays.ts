import { XMLParser } from "fast-xml-parser";

export type PublicHoliday = { date: string; name: string };
export type CalendarHoliday = PublicHoliday;
export type HolidayResult = {
  holidays: CalendarHoliday[];
  source: string;
  status: "live" | "cached" | "unavailable";
  message?: string;
};

// KASI documents getRestDeInfo separately from commemorative days. A TourAPI
// service key does not grant access to this service; never assume that it does.
const API_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const API_SOURCE = "https://www.data.go.kr/data/15012690/openapi.do";
const CALENDAR_URL = "https://astro.kasi.re.kr/life/post/calendarData";
const FRESH_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false });

type Fetcher = (input: string | URL, init?: RequestInit & { next?: { revalidate: number } }) => Promise<Response>;

export function validHolidayYear(year: number) { return Number.isInteger(year) && year >= 1900 && year <= 2100; }
function dateIso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function normalize(holidays: CalendarHoliday[]) {
  return [...new Map(holidays.map(holiday => [`${holiday.date}:${holiday.name}`, holiday])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));
}

/** Reject incomplete/error responses instead of quietly showing a blank year. */
export function parseHolidayApi(body: string, year: number): CalendarHoliday[] {
  const parsed = (body.trim().startsWith("{") ? JSON.parse(body) : xml.parse(body)) as {
    response?: { header?: { resultCode?: unknown }; body?: { totalCount?: unknown; items?: { item?: unknown } | string } };
  };
  const response = parsed?.response;
  if (String(response?.header?.resultCode) !== "00") throw new Error("holiday_provider_rejected");
  const items = response?.body?.items;
  const raw = items && typeof items === "object" ? items.item : undefined;
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const total = Number(response?.body?.totalCount);
  if (!Number.isInteger(total) || total < 1 || total > 100 || rows.length !== total) throw new Error("holiday_provider_incomplete");
  const holidays: CalendarHoliday[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("holiday_provider_invalid");
    const item = row as Record<string, unknown>;
    if (String(item.isHoliday) !== "Y") continue;
    const value = String(item.locdate);
    const name = String(item.dateName ?? "").trim();
    if (!/^\d{8}$/.test(value) || Number(value.slice(0, 4)) !== year || !name || name.length > 100) throw new Error("holiday_provider_invalid");
    const date = dateIso(year, Number(value.slice(4, 6)), Number(value.slice(6, 8)));
    if (!date) throw new Error("holiday_provider_invalid");
    holidays.push({ date, name });
  }
  const result = normalize(holidays);
  if (result.length < 10 || result.length > 100 || !result.some(day => day.date === `${year}-01-01`) || !result.some(day => day.date === `${year}-12-25`)) throw new Error("holiday_provider_incomplete_year");
  return result;
}

function textOf(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}
function datesInCell(value: string, year: number) {
  const dates = [...value.matchAll(/(?:(\d{1,2})\s*월\s*[~～〜–-]?\s*)?(\d{1,2})\s*일/g)];
  if (!dates.length || dates.length > 2) throw new Error("holiday_calendar_invalid_date");
  const firstMonth = Number(dates[0][1]);
  const first = dateIso(year, firstMonth, Number(dates[0][2]));
  if (!first) throw new Error("holiday_calendar_invalid_date");
  if (dates.length === 1) return [first];
  const end = dateIso(year, Number(dates[1][1] ?? firstMonth), Number(dates[1][2]));
  if (!end) throw new Error("holiday_calendar_invalid_date");
  const startMs = Date.parse(`${first}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const days = (endMs - startMs) / 86400000;
  if (!Number.isInteger(days) || days < 0 || days > 6 || !/[~～〜–-]/.test(value)) throw new Error("holiday_calendar_invalid_range");
  return Array.from({ length: days + 1 }, (_, offset) => new Date(startMs + offset * 86400000).toISOString().slice(0, 10));
}

/** Public, keyless KASI calendar material. Its holiday table is deliberately
 * isolated from the adjacent lunar-date, Sunday and commemorative-day tables. */
export function parseKasiCalendar(html: string, year: number): CalendarHoliday[] {
  const yearHeading = html.match(/<h2\b[^>]*class=["'][^"']*boardlist_tit[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
  if (!yearHeading || textOf(yearHeading[1]) !== `${year}년 달력자료`) throw new Error("holiday_calendar_wrong_year");
  const table = html.match(/<h[2-4]\b[^>]*>\s*국경일과\s*공휴일\s*<\/h[2-4]>\s*(?:<div\b[^>]*>\s*)?<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error("holiday_calendar_missing_table");
  const holidays: CalendarHoliday[] = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => textOf(cell[1]));
    if (!cells.length) continue;
    if (cells.length !== 4) throw new Error("holiday_calendar_changed_table");
    for (let index = 0; index < 4; index += 2) {
      const name = cells[index];
      if (!name && !cells[index + 1]) continue;
      // KASI uses two stars for national days that are not public holidays.
      if (/\*\s*\*/.test(name)) continue;
      const label = name.replace(/\*/g, "").trim();
      if (!label || label.length > 100) throw new Error("holiday_calendar_invalid_name");
      for (const date of datesInCell(cells[index + 1], year)) holidays.push({ date, name: label });
    }
  }
  const result = normalize(holidays);
  if (result.length < 10 || result.length > 40 || !result.some(day => day.date === `${year}-01-01`) || !result.some(day => day.date === `${year}-12-25`)) {
    throw new Error("holiday_calendar_incomplete");
  }
  return result;
}

export function createHolidayService(options: { fetcher?: Fetcher; now?: () => number; serviceKey?: () => string | undefined } = {}) {
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const key = options.serviceKey ?? (() => process.env.HOLIDAY_API_SERVICE_KEY || process.env.KASI_API_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY);
  const cache = new Map<number, { result: HolidayResult; at: number }>();
  const pending = new Map<number, Promise<HolidayResult>>();
  async function fetchText(url: URL, accept = "text/html") {
    const response = await fetcher(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(4500), next: { revalidate: 21600 } });
    if (!response.ok) throw new Error("holiday_source_unavailable");
    const body = await response.text();
    if (body.length > 500000) throw new Error("holiday_source_too_large");
    return body;
  }
  async function refresh(year: number): Promise<HolidayResult> {
    const serviceKey = key()?.trim();
    if (serviceKey) {
      try {
        let decoded = serviceKey;
        try { decoded = decodeURIComponent(serviceKey); } catch { /* A plain key may contain a literal %. */ }
        const url = new URL(API_URL);
        url.searchParams.set("serviceKey", decoded); url.searchParams.set("solYear", String(year));
        url.searchParams.set("pageNo", "1"); url.searchParams.set("numOfRows", "100"); url.searchParams.set("_type", "json");
        const holidays = parseHolidayApi(await fetchText(url, "application/json, application/xml"), year);
        return { holidays, source: API_SOURCE, status: "live" };
      } catch { /* The public calendar remains available without an API subscription. */ }
    }
    try {
      const url = new URL(CALENDAR_URL);
      url.searchParams.set("search_year", String(year)); url.searchParams.set("bbs_uniq_id", "calendarData");
      const holidays = parseKasiCalendar(await fetchText(url), year);
      return { holidays, source: url.toString(), status: "live", message: "한국천문연구원 달력자료 기준이에요. 새로 지정되는 임시공휴일은 발표 후 달라질 수 있어요." };
    } catch {
      const previous = cache.get(year);
      if (previous && now() - previous.at < STALE_MS) return { ...previous.result, status: "cached", message: "공휴일 정보를 갱신하지 못해 마지막으로 확인한 자료를 표시해요." };
      return { holidays: [], source: CALENDAR_URL, status: "unavailable", message: "이 연도의 공휴일 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
  }
  return async function load(year: number): Promise<HolidayResult> {
    if (!validHolidayYear(year)) return { holidays: [], source: CALENDAR_URL, status: "unavailable", message: "1900년부터 2100년 사이의 연도를 선택해 주세요." };
    const stored = cache.get(year);
    if (stored && now() - stored.at < FRESH_MS) return { ...stored.result, status: "cached" };
    const inflight = pending.get(year);
    if (inflight) return inflight;
    const request = refresh(year).then(result => {
      if (result.status === "live") cache.set(year, { result, at: now() });
      return result;
    }).finally(() => { pending.delete(year); });
    pending.set(year, request);
    return request;
  };
}

export const loadKoreanHolidays = createHolidayService();
