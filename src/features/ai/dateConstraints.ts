import type { AIPlannerState } from "@/features/planning/types/plan";

function clock(hour: string, minute: string | undefined, period: string | undefined, fallbackHour = 14) {
  let h = Number(hour);
  const m = Number(minute ?? 0);
  if (h > 23 || m > 59) return null;
  if (/오후|저녁|밤/.test(period ?? "") && h < 12) h += 12;
  else if (/오전|아침|새벽/.test(period ?? "") && h === 12) h = 0;
  else if (!period && h < 12 && fallbackHour >= 12) h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function explicitDateConstraints(message: string, previous?: AIPlannerState, today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })) {
  const result: Partial<AIPlannerState> = {};
  // Match the requested range, not an earlier complaint such as "왜 6시부터야?".
  const range = [...message.matchAll(/(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:부터|[~〜–-])\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)(?:\s*까지)?/g)].at(-1);
  if (range) {
    const fallbackHour = Number(previous?.startTime?.slice(0, 2) ?? 14);
    const start = clock(range[2], range[3] ?? range[4], range[1], fallbackHour);
    const end = clock(range[6], range[7] ?? range[8], range[5] ?? range[1], start ? Number(start.slice(0, 2)) : fallbackHour);
    if (start && end) Object.assign(result, { startTime: start, endTime: end, timeWindow: "any" });
  }
  const budget = message.match(/(\d+(?:\.\d+)?)\s*(만\s*원|만원|천\s*원|원)/);
  if (budget && /예산|안에서|이내|이하|까지|둘이|합쳐|총/.test(message)) {
    result.budgetWon = Math.round(Number(budget[1]) * (budget[2].includes("만") ? 10000 : budget[2].includes("천") ? 1000 : 1));
  }
  if (/걷(?:는\s*거|기|는\s*것)?\s*(?:적게|싫|힘들)|많이\s*안\s*걷|많이\s*걷기\s*싫|동선\s*짧|도보\s*최소/.test(message)) result.walkingPreference = "short";
  if (/예산\s*(?:상관없|제한없|신경\s*쓰지)/.test(message)) result.budgetWon = null;
  const weekdays = "일월화수목금토";
  const day = message.match(/(이번\s*주|다음\s*주)?\s*([일월화수목금토])요일/);
  const base = new Date(`${today}T00:00:00Z`);
  if (day && !Number.isNaN(base.getTime())) {
    const target = weekdays.indexOf(day[2]);
    let offset = (target - base.getUTCDay() + 7) % 7;
    if (/다음/.test(day[1] ?? "")) offset = 7 - ((base.getUTCDay() + 6) % 7) + ((target + 6) % 7);
    base.setUTCDate(base.getUTCDate() + offset);
    result.dateLabel = base.toISOString().slice(0, 10);
  } else if (/오늘|내일|모레/.test(message) && !Number.isNaN(base.getTime())) {
    base.setUTCDate(base.getUTCDate() + (/모레/.test(message) ? 2 : /내일/.test(message) ? 1 : 0));
    result.dateLabel = base.toISOString().slice(0, 10);
  }
  return result;
}
