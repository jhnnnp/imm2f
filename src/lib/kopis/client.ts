import { XMLParser } from "fast-xml-parser";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import { candidateActivitySlot } from "@/features/ai/dateCourse";
import { tripDayYmd } from "@/features/ai/dateBrief";

type XmlRow = Record<string, unknown>;
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false });
const API_BASE = "https://kopis.or.kr/openApi/restful";
const eventCache = new Map<string, { expiresAt: number; events: Event[] }>();
const eventInflight = new Map<string, Promise<Event[]>>();

function field(row: XmlRow, name: string) {
  return typeof row[name] === "string" ? String(row[name]).trim() : "";
}

function rows(xml: string): XmlRow[] {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  try {
    const parsed = parser.parse(xml) as { dbs?: { db?: XmlRow | XmlRow[] } };
    const db = parsed?.dbs?.db;
    return (Array.isArray(db) ? db : db ? [db] : []).filter(item => item && typeof item === "object");
  } catch { return []; }
}

function compact(value: string) {
  return value.normalize("NFKC").replace(/\([^)]*\)/g, "").replace(/[^가-힣a-z0-9]/gi, "").toLowerCase();
}

// KOPIS appends historical facility names and the stage in parentheses. Match
// the leading facility name, then require the facility ID's coordinates.
function facilityBase(value: string) {
  return compact(value.split("(")[0] ?? "");
}

export function kopisFacilityMatches(venue: DiscoverCandidate, facilityName: string, facility: XmlRow) {
  if (candidateActivitySlot(venue) !== "performance" || !facilityName) return false;
  const name = field(facility, "fcltynm");
  const latitude = Number(field(facility, "la"));
  const longitude = Number(field(facility, "lo"));
  if (!name || facilityBase(name) !== facilityBase(facilityName)
    || facilityBase(name) !== compact(venue.name)
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return distanceMeters(venue.coordinates, [longitude, latitude]) <= 180;
}

function koreaWeekday(ymd: string) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!/^\d{8}$/.test(ymd) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return -1;
  return date.getUTCDay();
}

/** Only unambiguous weekday rules count as a displayed showtime. */
export function kopisShowtimes(guidance: string, ymd: string, singleDay = false) {
  const weekday = koreaWeekday(ymd);
  if (weekday < 0) return [];
  if (singleDay) return [...new Set(guidance.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) ?? [])]
    .map(time => time.padStart(5, "0")).sort();
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  const parts = [...guidance.matchAll(/([월화수목금토일])요일\s*(?:[~-]\s*([월화수목금토일])요일)?\s*\(([^)]*)\)/g)];
  const times = new Set<string>();
  for (const part of parts) {
    const start = names.indexOf(part[1]);
    const end = part[2] ? names.indexOf(part[2]) : start;
    const covered = start <= end ? weekday >= start && weekday <= end : weekday >= start || weekday <= end;
    if (!covered || /없음|휴관|휴무/.test(part[3])) continue;
    for (const time of part[3].match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) ?? []) times.add(time.padStart(5, "0"));
  }
  return [...times].sort();
}

function coversDay(start: string, end: string, ymd: string) {
  const from = start.replace(/\D/g, "").slice(0, 8);
  const to = end.replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(from) && /^\d{8}$/.test(to) && from <= ymd && ymd <= to;
}

async function getXml(path: string, params: Record<string, string>, key: string) {
  const url = new URL(`${API_BASE}/${path}`);
  url.searchParams.set("service", key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6500), cache: "no-store" });
    return response.ok ? await response.text() : "";
  } catch { return ""; }
}

type Event = NonNullable<DiscoverCandidate["performanceEvent"]>;

async function fetchKopisPerformances(venue: DiscoverCandidate, ymd: string, key: string): Promise<Event[]> {
  const sameFacility = (name: string) => facilityBase(name) === compact(venue.name);
  const active = (state: string) => !/완료|취소|중단/.test(state);
  const listing = rows(await getXml("pblprfr", {
    stdate: ymd, eddate: ymd, cpage: "1", rows: "30", shprfnmfct: venue.name,
  }, key)).filter(row => /^PF\d+$/.test(field(row, "mt20id")) && coversDay(field(row, "prfpdfrom"), field(row, "prfpdto"), ymd)
    && sameFacility(field(row, "fcltynm")) && active(field(row, "prfstate")));
  const details = await Promise.all(listing.slice(0, 6).map(async row => {
    const id = field(row, "mt20id");
    const detail = rows(await getXml(`pblprfr/${id}`, {}, key))[0];
    if (!detail || field(detail, "mt20id") !== id || !active(field(detail, "prfstate"))) return null;
    const facilityId = field(detail, "mt10id");
    if (!/^FC\d+$/.test(facilityId)) return null;
    const facility = rows(await getXml(`prfplc/${facilityId}`, {}, key))[0];
    if (!facility || field(facility, "mt10id") !== facilityId || !kopisFacilityMatches(venue, field(detail, "fcltynm"), facility)) return null;
    const singleDay = field(detail, "prfpdfrom").replace(/\D/g, "") === ymd
      && field(detail, "prfpdto").replace(/\D/g, "") === ymd;
    const showtimes = kopisShowtimes(field(detail, "dtguidance"), ymd, singleDay);
    if (!showtimes.length) return null;
    return {
      id, title: field(detail, "prfnm"), dateYmd: ymd, showtimes,
      genre: field(detail, "genrenm"),
      sourceUrl: `https://kopis.or.kr/por/db/pblprfr/pblprfrView.do?mt20Id=${id}`,
      checkedAt: new Date().toISOString(),
    } satisfies Event;
  }));
  return details.filter((event): event is Event => Boolean(event?.title)).slice(0, 3);
}

export async function findKopisPerformances(venue: DiscoverCandidate, ymd: string): Promise<Event[]> {
  const key = process.env.KOPIS_SERVICE_KEY?.trim();
  if (!key || koreaWeekday(ymd) < 0 || candidateActivitySlot(venue) !== "performance") return [];
  const cacheKey = `${venue.externalSource}:${venue.externalPlaceId}:${ymd}`;
  const cached = eventCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.events;
  const pending = eventInflight.get(cacheKey);
  if (pending) return pending;
  const request = fetchKopisPerformances(venue, ymd, key).then(events => {
    eventCache.set(cacheKey, { events, expiresAt: Date.now() + (events.length ? 2 * 60 * 60_000 : 15 * 60_000) });
    if (eventCache.size > 256) eventCache.delete(eventCache.keys().next().value!);
    return events;
  }).finally(() => eventInflight.delete(cacheKey));
  eventInflight.set(cacheKey, request);
  return request;
}

export async function attachKopisPerformances(candidates: DiscoverCandidate[], dateLabel: string | null, days = 1) {
  const ymd = String(dateLabel ?? "").replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(ymd) || !process.env.KOPIS_SERVICE_KEY?.trim()) return candidates;
  const venues = candidates.filter(candidate => candidateActivitySlot(candidate) === "performance").slice(0, 5);
  const dates = Array.from({ length: Math.min(3, Math.max(1, days)) }, (_, day) => tripDayYmd({ dateLabel }, day));
  const results = await Promise.all(venues.map(async venue => (await Promise.all(dates.map(date =>
    findKopisPerformances(venue, date)))).flat()[0]));
  const byId = new Map(venues.map((venue, index) => [`${venue.externalSource}:${venue.externalPlaceId}`, results[index]]));
  return candidates.map(candidate => ({ ...candidate,
    performanceEvent: byId.get(`${candidate.externalSource}:${candidate.externalPlaceId}`) ?? candidate.performanceEvent,
  }));
}
