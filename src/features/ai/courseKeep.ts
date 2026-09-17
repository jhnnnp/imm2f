import type { PlanItem, PlanKind } from "@/features/planning/types/plan";
import { addDays } from "@/lib/dates";

export const DATE_KEEP_LABEL = "데이트 코스로 담기";
export const TRIP_KEEP_LABEL = "여행에 담기";

export type CourseKeepDestination = PlanKind;
export type CourseKeepIntent = "ask" | CourseKeepDestination;

export type CourseKeepInput = {
  destination: CourseKeepDestination;
  items: PlanItem[];
  startDate: string | null;
  dayCount: number;
  title: string;
};

export type CourseKeepResult = { ok: true } | { error: string };

export function courseDayCount(items: PlanItem[], nights = 0) {
  const fromItems = items.reduce((max, item) => Math.max(max, (item.dayIndex ?? 0) + 1), 1);
  const fromStay = nights > 0 ? nights + 1 : 1;
  return Math.max(1, Math.min(7, Math.max(fromItems, fromStay)));
}

export function tripEndDate(startDate: string, dayCount: number) {
  if (!startDate || dayCount <= 1) return startDate;
  return addDays(startDate, Math.max(1, dayCount) - 1);
}

export function datesInRange(startDate: string, dayCount: number) {
  if (!startDate) return [] as string[];
  return Array.from({ length: Math.max(1, dayCount) }, (_, index) => addDays(startDate, index));
}

export function staySpanLabel(dayCount: number) {
  if (dayCount <= 1) return "당일";
  return `${dayCount - 1}박 ${dayCount}일`;
}

export function courseKeepTitle(destination: CourseKeepDestination, region: string) {
  const where = region.trim();
  if (destination === "trip") return where ? `${where} 여행` : "우리가 고른 여행";
  return where ? `${where} 데이트` : "우리가 고른 데이트";
}

export function keepIntent(message: string): CourseKeepIntent | null {
  const text = message.trim();
  if (!text) return null;
  if (text === DATE_KEEP_LABEL) return "date";
  if (text === TRIP_KEEP_LABEL) return "trip";
  const keep = /담아|이걸로\s*(하자|할게|좋아)|이 코스|저장해|확정|마음에\s*들/.test(text)
    && !/바꿔|변경|빼|말고|대신|추가|넣어/.test(text);
  if (!keep) return null;
  const wantsTrip = /여행/.test(text);
  const wantsDate = /데이트/.test(text);
  if (wantsTrip && !wantsDate) return "trip";
  if (wantsDate && !wantsTrip) return "date";
  return "ask";
}
