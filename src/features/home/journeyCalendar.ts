export type JourneyCalendarCell = {
  iso: string;
  day: number;
  outside: boolean;
  trip: boolean;
  start: boolean;
  today: boolean;
};

function parseDay(iso: string | null) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? date : null;
}

/** A decorative Sunday-first month, using date-only UTC arithmetic in every timezone. */
export function buildJourneyCalendar(startDate: string | null, dayCount: number, today: string): {
  monthLabel: string;
  cells: JourneyCalendarCell[];
} {
  const start = parseDay(startDate);
  const focus = start ?? parseDay(today);
  if (!focus) return { monthLabel: "", cells: [] };

  const year = focus.getUTCFullYear();
  const month = focus.getUTCMonth();
  const gridStart = new Date(focus);
  gridStart.setUTCDate(1);
  gridStart.setUTCDate(1 - gridStart.getUTCDay());
  const duration = Number.isFinite(dayCount) ? Math.max(0, Math.floor(dayCount)) : 0;
  const startTime = start?.getTime() ?? 0;
  const cells = Array.from({ length: 42 }, (_, index): JourneyCalendarCell => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const iso = date.toISOString().slice(0, 10);
    const offset = (date.getTime() - startTime) / 86_400_000;
    const trip = Boolean(start && offset >= 0 && offset < duration);
    return {
      iso,
      day: date.getUTCDate(),
      outside: date.getUTCMonth() !== month,
      trip,
      start: trip && iso === startDate,
      today: iso === today,
    };
  });

  // The sixth row can belong entirely to next month while still containing the trip.
  const omitLastWeek = cells.slice(35).every(cell => cell.outside && !cell.trip);
  return {
    monthLabel: `${year}년 ${month + 1}월`,
    cells: omitLastWeek ? cells.slice(0, 35) : cells,
  };
}
