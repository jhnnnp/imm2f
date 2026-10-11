import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateCandidateKey } from "./dateCourse";

export type PlanningEvidenceProfile = {
  identity: "provider_candidate" | "unverified";
  openingAtRequiredTime: "confirmed_open" | "confirmed_closed" | "unknown";
  experience: "sourced" | "unknown";
};

/** Only a current, exact-branch, source-checked daily/date-specific hours
 * observation can prove an explicitly requested visit time. A provider's
 * generic openingHours string is useful context but not that proof. */
export function requiredOpeningTime(state: AIPlannerState): string | null {
  let required: string | null = null;
  for (const request of state.userRequests ?? []) {
    if (/영업(?:\s*시간|\s*조건|\s*여부)?|운영(?:\s*시간|\s*조건|\s*여부)?/.test(request)
      && /상관\s*없|무관|(?:조건|제약).{0,8}(?:빼|없애|해제|취소)|(?:신경|확인).{0,6}(?:안\s*써|필요\s*없)/.test(request)) {
      required = null;
      continue;
    }
    const strict = /(?:확실히|반드시|꼭).{0,16}(?:열|영업|운영)|(?:열|영업|운영).{0,16}(?:곳만|확실히|반드시)/.test(request);
    const correction = required !== null && /영업|운영|열려|여는/.test(request)
      && /대신|바꿔|변경|수정/.test(request) && !/\?|알려|궁금/.test(request);
    if (!strict && !correction) continue;
    const digital = request.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (digital) { required = `${digital[1].padStart(2, "0")}:${digital[2]}`; continue; }
    const korean = request.match(/(밤|오후|오전)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
    if (!korean) continue;
    let hour = Number(korean[2]);
    const minute = Number(korean[3] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) continue;
    if (korean[1] === "밤" || korean[1] === "오후") hour = hour % 12 + 12;
    else hour %= 12;
    required = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return required;
}

export type VerifiedOpeningWindow = { startMinutes: number; endMinutes: number; latestEntryMinutes?: number };

const HOUR_RANGE = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|[-–—])\s*([01]?\d|2[0-3]|24):([0-5]\d)(?!\d)/g;
const WEEKDAYS = "일월화수목금토";
const clock = (hour: string, minute: string) => Number(hour) * 60 + Number(minute);

function weekdaySet(text: string): Set<number> {
  const output = new Set<number>();
  if (/평일/.test(text)) [1, 2, 3, 4, 5].forEach(day => output.add(day));
  if (/주말/.test(text)) [0, 6].forEach(day => output.add(day));
  for (const match of text.matchAll(/([일월화수목금토])(?:요일)?\s*[~–-]\s*([일월화수목금토])(?:요일)?/g)) {
    const start = WEEKDAYS.indexOf(match[1]); const end = WEEKDAYS.indexOf(match[2]);
    for (let day = start; ; day = (day + 1) % 7) { output.add(day); if (day === end) break; }
  }
  for (const match of text.matchAll(/(?:^|[\s,·/()])(?:매주\s*)?([일월화수목금토])(?:요일|(?=[\s,·/()\d]))/g))
    output.add(WEEKDAYS.indexOf(match[1]));
  return output;
}

function datesInText(text: string): string[] {
  return [...text.matchAll(/(?<!\d)(20\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})(?:일)?(?!\d)/g)]
    .map(match => `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`);
}

/** Current exact-branch source hours only. Null is unknown; [] is confirmed
 * closed. Multiple service periods, breaks and last-entry limits remain distinct. */
export function verifiedOpeningWindows(candidate: DiscoverCandidate, dayYmd: string | null,
  now = Date.now()): VerifiedOpeningWindow[] | null {
  if (!dayYmd || !/^\d{8}$/.test(dayYmd)) return null;
  const visit = Date.parse(`${dayYmd.slice(0, 4)}-${dayYmd.slice(4, 6)}-${dayYmd.slice(6, 8)}T00:00:00+09:00`);
  if (!Number.isFinite(visit) || new Date(visit + 9 * 3_600_000).toISOString().slice(0, 10).replaceAll("-", "") !== dayYmd) return null;
  const weekday = new Date(visit + 9 * 3_600_000).getUTCDay();
  const observations = (candidate.evidence ?? []).flatMap(item => {
    if (item.attribute !== "hours" || item.verification !== "source_checked"
      || item.venueId !== dateCandidateKey(candidate) || !item.url) return [];
    const checked = Date.parse(item.checkedAt);
    if (!Number.isFinite(checked) || checked > now || now - checked > 7 * 86_400_000) return [];
    const dates = datesInText(item.text);
    if (dates.length && !dates.includes(dayYmd)) return [];
    if (!dates.length && (visit - checked > 30 * 86_400_000
      || !/매일|연중무휴|평일|주말|[일월화수목금토]요일|[일월화수목금토]\s*[~–-]\s*[일월화수목금토]/.test(item.text))) return [];
    return [{ item, checked, priority: dates.includes(dayYmd) ? 2 : 1 }];
  }).sort((a, b) => b.priority - a.priority || b.checked - a.checked);
  if (!observations.length) return null;
  const text = observations[0].item.text.replace(/[ \t]+/g, " ");
  const closed = /휴무|휴관|영업\s*안\s*함|운영\s*안\s*함/;
  const notClosed = /휴무(?:일)?\s*없|휴관(?:일)?\s*없/;
  const clauses = text.split(/[;；\n]|[,，]\s*(?=(?:매일|연중무휴|브레이크|휴게|휴식|라스트|마지막|최종|입장|주문))|(?=(?:평일|주말|(?:매주\s*)?[일월화수목금토](?:요일)?\s*[~–-]\s*[일월화수목금토](?:요일)?|(?:매주\s*)?[일월화수목금토]요일)\s*(?:은|는)?\s*(?:\d|(?:정기\s*)?휴무|휴관))/);
  const applicable = clauses.filter(clause => { const days = weekdaySet(clause); return !days.size || days.has(weekday); });
  if (applicable.some(clause => closed.test(clause) && !notClosed.test(clause)
    && (weekdaySet(clause).has(weekday) || observations[0].priority === 2 && !weekdaySet(clause).size))) return [];
  // A daily timetable followed by another weekday's closure still applies.
  const service = applicable.filter(clause => !closed.test(clause) || notClosed.test(clause));
  const ranges: VerifiedOpeningWindow[] = [];
  const breaks: VerifiedOpeningWindow[] = [];
  let latestEntry: number | undefined;
  for (const clause of service) {
    if (/24\s*시간|24\s*시\s*(?:영업|운영)/.test(clause)) ranges.push({ startMinutes: 0, endMinutes: 1440 });
    for (const match of clause.matchAll(HOUR_RANGE)) {
      if (match[3] === "24" && match[4] !== "00") continue;
      const start = clock(match[1], match[2]); let end = clock(match[3], match[4]);
      if (end <= start) end += 1440;
      const preceding = clause.slice(Math.max(0, match.index! - 28), match.index);
      (/브레이크(?:\s*타임)?|휴게\s*시간|휴식\s*시간|쉬는\s*시간/i.test(preceding) ? breaks : ranges)
        .push({ startMinutes: start, endMinutes: end });
    }
    const entry = clause.match(/(?:라스트\s*오더|마지막\s*주문|주문\s*마감|최종\s*입장|입장\s*마감)\s*[:：]?\s*([01]?\d|2[0-3]):([0-5]\d)/);
    if (entry) latestEntry = clock(entry[1], entry[2]);
  }
  if (!ranges.length) return null;
  let windows = ranges;
  for (const pause of breaks) windows = windows.flatMap(window => {
    if (pause.endMinutes <= window.startMinutes || pause.startMinutes >= window.endMinutes) return [window];
    return [{ startMinutes: window.startMinutes, endMinutes: Math.min(window.endMinutes, pause.startMinutes) },
      { startMinutes: Math.max(window.startMinutes, pause.endMinutes), endMinutes: window.endMinutes }]
      .filter(part => part.endMinutes > part.startMinutes);
  });
  return windows.map(window => ({ ...window, ...(latestEntry === undefined ? {} : {
    latestEntryMinutes: latestEntry < window.startMinutes && window.endMinutes > 1440 ? latestEntry + 1440 : latestEntry,
  }) })).sort((a, b) => a.startMinutes - b.startMinutes);
}

export function planningEvidenceProfile(candidate: DiscoverCandidate, requiredTime: string | null,
  dayYmd: string | null, now = Date.now()): PlanningEvidenceProfile {
  const identity = candidate.externalPlaceId && candidate.externalSource ? "provider_candidate" : "unverified";
  const experience = (candidate.evidence ?? []).some(item => item.attribute === "experience"
    && item.verification === "source_checked" && item.url && item.venueId === dateCandidateKey(candidate))
    ? "sourced" : "unknown";
  const opening = requiredTime ? verifiedOpeningAtVisit(candidate, dayYmd, requiredTime, 0, now) : "unknown";
  return { identity, experience, openingAtRequiredTime: opening === "open" ? "confirmed_open"
    : opening === "closed" ? "confirmed_closed" : "unknown" };
}

/** Never treat an unknown provider string as a guarantee. A visit must fit a
 * whole service period, including breaks, closing and last-entry boundaries. */
export function verifiedOpeningAtVisit(candidate: DiscoverCandidate, dayYmd: string | null,
  startTime: string, durationMinutes: number, now = Date.now()): "open" | "closed" | "unknown" {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !Number.isFinite(durationMinutes) || durationMinutes < 0) return "unknown";
  const windows = verifiedOpeningWindows(candidate, dayYmd, now);
  if (windows === null) return "unknown";
  const start = clock(startTime.slice(0, 2), startTime.slice(3));
  return windows.some(window => [start, start + 1440].some(at => at >= window.startMinutes
    && at < window.endMinutes && at + durationMinutes <= window.endMinutes
    && (window.latestEntryMinutes === undefined || at <= window.latestEntryMinutes))) ? "open" : "closed";
}
