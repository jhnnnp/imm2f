import { isIsoDate } from "@/lib/dates";

export type CoupleKeyDates = {
  relationshipStartedOn: string | null;
  birthdays: Array<{ id: string; name: string; date: string }>;
};
export type KeyDateEvent = { id: string; date: string; title: string; kind: "birthday" | "anniversary" | "milestone"; detail: string };

const DAY = 86_400_000;
function utcDate(iso: string) { return Date.parse(`${iso}T00:00:00Z`); }
function isoDate(value: number) { return new Date(value).toISOString().slice(0, 10); }
function yearlyDate(date: string, year: number) {
  const candidate = `${year}-${date.slice(5)}`;
  // A leap-day birthday still appears every year, with an explicit note.
  return isIsoDate(candidate) ? candidate : `${year}-02-28`;
}

/** Project shared dates instead of writing duplicate recurring calendar rows. */
export function keyDateEvents(dates: CoupleKeyDates, year: number): KeyDateEvent[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return [];
  const events: KeyDateEvent[] = [];
  const ids = new Set<string>();
  for (const birthday of dates.birthdays) {
    if (!isIsoDate(birthday.date) || Number(birthday.date.slice(0, 4)) > year || ids.has(birthday.id)) continue;
    ids.add(birthday.id);
    const date = yearlyDate(birthday.date, year);
    events.push({ id: `birthday:${birthday.id}:${year}`, date, title: `${birthday.name.trim() || "우리"}의 생일`, kind: "birthday",
      detail: birthday.date.endsWith("02-29") && date.endsWith("02-28") ? "2월 29일 생일 · 평년에는 2월 28일에 표시해요." : "매년 함께 챙기는 생일" });
  }
  const start = dates.relationshipStartedOn;
  if (isIsoDate(start)) {
    const started = utcDate(start);
    const years = year - Number(start.slice(0, 4));
    if (years >= 0) events.push({ id: `anniversary:${year}`, date: yearlyDate(start, year),
      title: years === 0 ? "우리의 첫날" : `우리의 ${years}주년`, kind: "anniversary", detail: `${start}부터 함께하고 있어요.${start.endsWith("02-29") && !isIsoDate(`${year}-02-29`) ? " 평년 기념일은 2월 28일에 표시해요." : ""}` });
    // The day we started dating is day 1: our 100th day is start + 99.
    const from = utcDate(`${year}-01-01`);
    const until = utcDate(`${year}-12-31`);
    const first = Math.max(1, Math.ceil(((from - started) / DAY + 1) / 100));
    const last = Math.floor(((until - started) / DAY + 1) / 100);
    for (let n = first; n <= last; n++) {
      const dayCount = n * 100;
      const date = isoDate(started + (dayCount - 1) * DAY);
      events.push({ id: `milestone:${dayCount}`, date, title: `함께한 지 ${dayCount.toLocaleString("ko-KR")}일`, kind: "milestone", detail: "사귄 첫날을 1일로 세는 기념일이에요." });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
