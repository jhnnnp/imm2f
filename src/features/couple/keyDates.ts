import { isIsoDate, seoulTodayIso } from "@/lib/dates";
import type { CoupleKeyDates } from "@/features/calendar/keyDateEvents";
export type { CoupleKeyDates } from "@/features/calendar/keyDateEvents";

export type CoupleKeyDatesSnapshot = {
  dates: CoupleKeyDates;
  revision: number;
  onboardingCompleted: boolean;
  persist: boolean;
  scope: { coupleId: string; userId: string } | null;
};
export const emptyCoupleKeyDates = (): CoupleKeyDates => ({ relationshipStartedOn: null, birthdays: [] });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Calendar entries retain their own identity across both partners' views. */
export function parseCoupleKeyDates(value: unknown, today = seoulTodayIso()): CoupleKeyDates | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const validDate = (date: unknown): date is string => typeof date === "string" && isIsoDate(date)
    && date >= "1900-01-01" && date <= today;
  if (raw.relationshipStartedOn !== null && !validDate(raw.relationshipStartedOn)) return null;
  if (!Array.isArray(raw.birthdays) || raw.birthdays.length > 2) return null;
  const ids = new Set<string>();
  const birthdays: CoupleKeyDates["birthdays"] = [];
  for (const item of raw.birthdays) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || !UUID.test(entry.id) || ids.has(entry.id)
      || typeof entry.name !== "string" || !entry.name.trim() || entry.name.trim().length > 60
      || !validDate(entry.date)) return null;
    ids.add(entry.id);
    birthdays.push({ id: entry.id, name: entry.name.trim(), date: entry.date });
  }
  return { relationshipStartedOn: raw.relationshipStartedOn as string | null, birthdays };
}
