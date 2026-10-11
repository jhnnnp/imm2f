import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import { addDays, isIsoDate } from "@/lib/dates";

export type TripDateSnapshot = { startDate: string; title: string; notes: string; dayCount: number; items: PlanItem[]; updatedAt?: string };
export const DEFAULT_TRIP_TITLE = "우리가 고른 여행";

export function hasTripContent(trip: Pick<TripDateSnapshot, "title" | "notes" | "items">) {
  return trip.items.length > 0 || Boolean(trip.notes.trim()) || Boolean(trip.title.trim() && trip.title.trim() !== DEFAULT_TRIP_TITLE);
}

export function tripDraftsWithActive(drafts: TripDateSnapshot[], plan: CouplePlan) {
  const startDate = plan.startDate ?? "";
  const remaining = drafts.filter(draft => draft.startDate !== startDate);
  return (hasTripContent(plan) ? [...remaining, { ...plan, startDate,
    updatedAt: drafts.find(draft => draft.startDate === startDate)?.updatedAt }] : remaining)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Choosing a date views its saved itinerary; it never assigns the visible trip. */
export function tripForDate(plan: CouplePlan, drafts: TripDateSnapshot[], startDate: string) : CouplePlan {
  if ((plan.startDate ?? "") === startDate) return plan;
  const saved = drafts.find(trip => trip.startDate === startDate);
  return { persist: plan.persist, revision: plan.revision, title: saved?.title ?? DEFAULT_TRIP_TITLE,
    notes: saved?.notes ?? "", items: saved?.items ?? [], dayCount: saved?.dayCount ?? 1, startDate: startDate || null };
}

export function tripDayOffset(startDate: string, dayCount: number, date: string) {
  if (!isIsoDate(startDate) || !isIsoDate(date)) return -1;
  return Array.from({ length: Math.max(1, Math.min(7, dayCount || 1)) }, (_, day) => addDays(startDate, day)).indexOf(date);
}

export function tripDateRange(startDate: string, dayCount: number) {
  if (!isIsoDate(startDate)) return "날짜 미정";
  return dayCount > 1 ? `${startDate} ~ ${addDays(startDate, Math.min(7, dayCount) - 1)}` : startDate;
}
