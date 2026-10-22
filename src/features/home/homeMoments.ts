import { keyDateEvents, type CoupleKeyDates, type KeyDateEvent } from "@/features/calendar/keyDateEvents";
import type { CoupleNote } from "@/features/lists/types";
import { isIsoDate } from "@/lib/dates";

export type UpcomingKeyDate = KeyDateEvent & { daysUntil: number };

/** Reuse the calendar's recurrence rules so the home and calendar always agree. */
export function upcomingKeyDates(dates: CoupleKeyDates, today: string): UpcomingKeyDate[] {
  if (!isIsoDate(today)) return [];
  const year = Number(today.slice(0, 4));
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  return [year, year + 1]
    .flatMap(eventYear => keyDateEvents(dates, eventYear))
    .filter(event => event.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map(event => ({ ...event, daysUntil: Math.round((Date.parse(`${event.date}T00:00:00Z`) - todayUtc) / 86_400_000) }));
}

/** Input retains the couple's manually saved list order within each status. */
export function chooseBucketWish(notes: readonly CoupleNote[]): CoupleNote | null {
  return notes.find(note => note.kind === "bucket" && note.status === "planning")
    ?? notes.find(note => note.kind === "bucket" && note.status === "wish")
    ?? null;
}
