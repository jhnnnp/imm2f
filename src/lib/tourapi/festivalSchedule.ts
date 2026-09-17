const FESTIVAL_QUERY_RE = /축제|페스티벌|페스티발|\bfestival\b/i;

/** KorService2 searchFestival2 uses legal-dong codes, not legacy areaCode. */
const LEGACY_AREA_TO_LDONG: Record<number, string> = {
  1: "11",
  2: "28",
  3: "30",
  4: "27",
  5: "29",
  6: "26",
  7: "31",
  8: "36",
  31: "41",
  32: "51",
  33: "43",
  34: "44",
  35: "47",
  36: "48",
  37: "52",
  38: "46",
  39: "50",
};

export function ldongRegnCdFromAreaCode(areaCode: number | undefined | null) {
  if (!areaCode) return "";
  return LEGACY_AREA_TO_LDONG[areaCode] ?? "";
}

export function isGenericFestivalQuery(query: string | undefined | null) {
  const value = query?.trim() ?? "";
  if (!value) return true;
  return value.replace(FESTIVAL_QUERY_RE, " ").replace(/\s+/g, " ").trim().length < 2;
}

export function koreaTodayYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replace(/-/g, "");
}

export function compactEventYmd(value: string | undefined | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

export function formatEventPeriod(eventStart?: string | null, eventEnd?: string | null) {
  const start = compactEventYmd(eventStart);
  const end = compactEventYmd(eventEnd);
  const pretty = (ymd: string) => `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
  if (start && end && start !== end) return `${pretty(start)} – ${pretty(end)}`;
  if (end) return pretty(end);
  if (start) return pretty(start);
  return "";
}

/** Ended or undated festivals should not appear in discover results. */
export function isEndedFestival(eventStart?: string | null, eventEnd?: string | null, today = koreaTodayYmd()) {
  const end = compactEventYmd(eventEnd) || compactEventYmd(eventStart);
  if (!end) return true;
  return end < today;
}

export function looksLikeFestivalQuery(query: string | undefined | null) {
  return FESTIVAL_QUERY_RE.test(query ?? "");
}

export function shouldSearchFestivals(input: {
  category?: string | null;
  query?: string | null;
  mood?: string | null;
}) {
  if (input.category === "festival") return true;
  if (input.category && input.category !== "all" && input.category !== "tourist") return false;
  return looksLikeFestivalQuery(`${input.query ?? ""} ${input.mood ?? ""}`);
}

export function festivalPeriodCoversYmd(period: string | undefined | null, day = koreaTodayYmd()) {
  const parts = [...String(period ?? "").matchAll(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/g)].map(match => `${match[1]}${match[2]}${match[3]}`);
  const start = compactEventYmd(parts[0]);
  const end = compactEventYmd(parts[1]) || start;
  if (!end) return false;
  const begin = start || end;
  return begin <= day && day <= end;
}
