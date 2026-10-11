import type { AIPlannerState } from "@/features/planning/types/plan";

function clock(hour: string, minute: string | undefined, period: string | undefined, fallbackHour = 14, digital = false) {
  let h = Number(hour);
  const m = Number(minute ?? 0);
  if (h > 23 || m > 59 || (period && (h < 1 || h > 12))) return null;
  if (period === "밤" && h === 12) h = 0;
  else if (/오후|저녁|밤/.test(period ?? "") && h < 12) h += 12;
  else if (/오전|아침|새벽/.test(period ?? "") && h === 12) h = 0;
  else if (!period && !digital && h < 12 && fallbackHour >= 12) h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function explicitDateConstraints(message: string, previous?: AIPlannerState, today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })) {
  const result: Partial<AIPlannerState> = {};
  // Local arrival and departure belong to one travel day, not every day.
  const clockWords: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6,
    일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
  const scheduleMessage = message.replace(/(열두|열한|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열)\s*시/g,
    (_, word: string) => `${clockWords[word]}시`).replace(/정오/g, "12:00").replace(/자정/g, "00:00")
    .split(/[,，;。!?\n]|그리고/).filter(clause =>
    !/(?:첫날|첫째\s*날|마지막\s*날|둘째\s*날|셋째\s*날|\d+\s*일차).*(?:도착|출발|귀가|돌아)/.test(clause)
    && !/현지\s*출발/.test(clause)).join(" ");
  // Match the requested range, not an earlier complaint such as "왜 6시부터야?".
  const range = [...scheduleMessage.matchAll(/(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:부터|[~〜–-])\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)(?:\s*까지)?/g)].at(-1);
  if (range) {
    const fallbackHour = Number(previous?.startTime?.slice(0, 2) ?? 14);
    const start = clock(range[2], range[3] ?? range[4], range[1], fallbackHour, Boolean(range[3]));
    const inheritedPeriod = !range[5] && !range[7] && /오전|아침/.test(range[1] ?? "")
      && Number(range[6]) < Number(range[2]) ? "오후" : range[1];
    const end = clock(range[6], range[7] ?? range[8], range[5] ?? inheritedPeriod, start ? Number(start.slice(0, 2)) : fallbackHour, Boolean(range[7]));
    if (start && end) Object.assign(result, { startTime: start, endTime: end, timeWindow: "any" });
  } else {
    const start = [...scheduleMessage.matchAll(/(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:쯤|정도|경)?\s*(?:에\s*)?(?:만나|모여|출발|시작|부터)/g)].at(-1)
      ?? scheduleMessage.match(/(?:시작|만나는|모이는)\s*(?:시간|시각)?(?:은|을|를)?\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:로|으로|에)?\s*(?:바꿔|변경|수정|늦춰|앞당|하자|해\s*줘)/);
    const end = [...scheduleMessage.matchAll(/(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:전|까지)(?:에는|에|는)?\s*(?:집|귀가|돌아|끝|마무리)/g)].at(-1)
      ?? scheduleMessage.match(/(?:종료|끝나는|마치는|귀가)\s*(?:시간|시각)?(?:은|을|를)?\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:로|으로|에)?\s*(?:바꿔|변경|수정|늦춰|앞당|하자|해\s*줘)/);
    const startTime = start && clock(start[2], start[3] ?? start[4], start[1], 14, Boolean(start[3]));
    const endTime = end && clock(end[2], end[3] ?? end[4], end[1], 18, Boolean(end[3]));
    if (startTime) Object.assign(result, { startTime, timeWindow: "any" });
    if (endTime) Object.assign(result, { endTime, timeWindow: "any" });
  }
  if (/걷(?:는\s*거|기|는\s*것)?\s*(?:적게|싫|힘들)|많이\s*안\s*걷|많이\s*걷기\s*싫|동선\s*짧|도보\s*최소/.test(message)) result.walkingPreference = "short";
  const weekdays = "일월화수목금토";
  const rejectedDate = (tail: string) => /^\s*(?:은|는|을|를)?\s*(?:말고|대신|취소|제외)/.test(tail);
  const day = [...message.matchAll(/(이번\s*주|다음\s*주)?\s*([일월화수목금토])요일/g)]
    .filter(match => !rejectedDate(message.slice(match.index + match[0].length))).at(-1);
  const base = new Date(`${today}T00:00:00Z`);
  const dated = [...message.matchAll(/(?:(\d{4})\s*(?:년|[-/.])\s*)?(\d{1,2})\s*(?:월\s*|[-/.]\s*)(\d{1,2})(?:\s*일)?(?!\d|\s*(?:만|천|원|시|분|박))/g)]
    .filter(match => !rejectedDate(message.slice(match.index + match[0].length))).at(-1);
  const relative = [...message.matchAll(/오늘|내일|모레/g)]
    .filter(match => !rejectedDate(message.slice(match.index + match[0].length))).at(-1);
  if (dated && !Number.isNaN(base.getTime())) {
    const year = Number(dated[1] ?? base.getUTCFullYear());
    const month = Number(dated[2]);
    const date = Number(dated[3]);
    const explicitDate = new Date(Date.UTC(year, month - 1, date));
    if (year >= 2000 && year <= 2100 && explicitDate.getUTCFullYear() === year
      && explicitDate.getUTCMonth() === month - 1 && explicitDate.getUTCDate() === date)
      result.dateLabel = explicitDate.toISOString().slice(0, 10);
  } else if (day && !Number.isNaN(base.getTime())) {
    const target = weekdays.indexOf(day[2]);
    let offset = (target - base.getUTCDay() + 7) % 7;
    if (/다음/.test(day[1] ?? "")) offset = 7 - ((base.getUTCDay() + 6) % 7) + ((target + 6) % 7);
    base.setUTCDate(base.getUTCDate() + offset);
    result.dateLabel = base.toISOString().slice(0, 10);
  } else if (relative && !Number.isNaN(base.getTime())) {
    base.setUTCDate(base.getUTCDate() + (relative[0] === "모레" ? 2 : relative[0] === "내일" ? 1 : 0));
    result.dateLabel = base.toISOString().slice(0, 10);
  }
  return result;
}
