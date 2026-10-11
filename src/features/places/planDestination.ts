import { isIsoDate } from "@/lib/dates";

/** Preserve the day selected in the planner when adding a place or returning. */
export function placePlanDestination(kind: "date" | "trip", source: "date" | "trip" | null, rawDay: string | null) {
  if (kind === "date") {
    const targetDate = source === "date" && isIsoDate(rawDay) ? rawDay : undefined;
    return { href: targetDate ? `/date?day=${targetDate}` : "/date", targetDate, dayIndex: 0 };
  }
  const dayIndex = source === "trip" && rawDay != null && /^[0-6]$/.test(rawDay) ? Number(rawDay) : 0;
  return { href: `/trip?day=${dayIndex}`, targetDate: undefined, dayIndex };
}
