import { distanceMeters } from "@/features/places/geo";

export type VisitWindow = { startMinutes: number; endMinutes: number; latestEntryMinutes?: number };
type Stop = { durationMinutes: number; coordinates?: [number, number] | null; dayIndex?: number; earliestStartTime?: string; visitWindows?: VisitWindow[] | null };
export const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
/** Earliest arrival whose entire stay fits one published service period. */
export function earliestFeasibleVisit(arrival: number, duration: number, windows?: VisitWindow[] | null): number | null {
  if (windows == null) return arrival;
  const feasible = windows.flatMap(window => {
    const start = Math.max(arrival, window.startMinutes);
    return start + duration <= window.endMinutes && start < window.endMinutes
      && (window.latestEntryMinutes === undefined || start <= window.latestEntryMinutes) ? [start] : [];
  });
  return feasible.length ? Math.min(...feasible) : null;
}

export const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function scheduleGapMinutes(from?: [number, number] | null, to?: [number, number] | null, mode: "walk" | "drive" | "transit" = "walk") {
  if (!from || !to) return 0;
  const meters = distanceMeters(from, to);
  if (meters < 120) return 0;
  if (mode === "drive") return Math.max(10, Math.ceil(meters / 500) + 10);
  if (mode === "transit") return Math.max(12, Math.ceil(meters / 250) + 12);
  return Math.max(8, Math.ceil(meters / 80));
}

/** Schedule each day independently. Never publish a course outside the agreed window. */
export function fitSchedule<T extends Stop>(stops: T[], start: string, end: string, mode: "walk" | "drive" | "transit" = "walk",
  dayWindows: Record<number, { start?: string; end?: string }> = {},
  verifiedTravelMinutes?: number[]): Array<T & { startTime: string }> | null {
  if (verifiedTravelMinutes && (verifiedTravelMinutes.length !== Math.max(0, stops.length - 1)
    || verifiedTravelMinutes.some(minutes => !Number.isFinite(minutes) || minutes < 0))) return null;
  if (![start, end].every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;
  const begin = clockMinutes(start);
  let finish = clockMinutes(end);
  if (finish <= begin) finish += 24 * 60;
  const output: Array<T & { startTime: string }> = [];
  const days = [...new Set(stops.map(stop => Math.max(0, Math.floor(stop.dayIndex ?? 0))))].sort((a, b) => a - b);
  for (const day of days) {
    const dayStart = dayWindows[day]?.start ?? start;
    const dayEnd = dayWindows[day]?.end ?? end;
    if (![dayStart, dayEnd].every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;
    const dayBegin = dayWindows[day]?.start ? clockMinutes(dayStart) : begin;
    const dayFinish = dayWindows[day]?.end ? clockMinutes(dayEnd) : finish;
    if (dayFinish <= dayBegin) return null;
    const positions = stops.map((stop, index) => ({ stop, index }))
      .filter(({ stop }) => Math.max(0, Math.floor(stop.dayIndex ?? 0)) === day);
    // The verified array indexes the full route, including day boundaries.
    // An interleaved day has no verified leg connecting its grouped stops.
    if (verifiedTravelMinutes && positions.some((entry, index) => index > 0 && entry.index !== positions[index - 1].index + 1)) return null;
    const group = positions.map(entry => entry.stop);
    if (group.some(stop => stop.visitWindows?.some(window => !Number.isFinite(window.startMinutes) || !Number.isFinite(window.endMinutes)
      || window.startMinutes < 0 || window.endMinutes <= window.startMinutes
      || window.latestEntryMinutes !== undefined && !Number.isFinite(window.latestEntryMinutes)))) return null;
    if (group.some(stop => stop.earliestStartTime !== undefined
      && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(stop.earliestStartTime))) return null;
    const gaps = positions.map(({ stop, index: originalIndex }, index) => index
      ? verifiedTravelMinutes?.[originalIndex - 1] ?? scheduleGapMinutes(group[index - 1].coordinates, stop.coordinates, mode) : 0);
    const available = dayFinish - dayBegin - gaps.reduce((a, b) => a + b, 0);
    const minimum = 30;
    if (available < minimum * group.length) return null;
    const durations = group.map(stop => Math.max(minimum, Math.min(180, Math.round(stop.durationMinutes) || 60)));
    const desired = durations.reduce((a, b) => a + b, 0);
    if (desired > available) {
      const flexible = desired - minimum * group.length;
      const allowance = available - minimum * group.length;
      durations.forEach((duration, index) => { durations[index] = minimum + Math.floor((duration - minimum) * allowance / flexible); });
    }
    const layOut = (values: number[]) => {
      let cursor = dayBegin;
      const rows = group.map((stop, index) => {
        cursor = Math.max(cursor + gaps[index], stop.earliestStartTime ? clockMinutes(stop.earliestStartTime) : dayBegin);
        const allowed = earliestFeasibleVisit(cursor, values[index], stop.visitWindows);
        cursor = allowed ?? Infinity;
        const row = { ...stop, dayIndex: day, startTime: formatClock(cursor), durationMinutes: values[index] };
        cursor += values[index];
        return row;
      });
      return { rows, finish: cursor };
    };
    let scheduled = layOut(durations);
    if (scheduled.finish > dayFinish) {
      if (layOut(durations.map(() => minimum)).finish > dayFinish) return null;
      let low = 0; let high = 1;
      for (let iteration = 0; iteration < 14; iteration++) {
        const fraction = (low + high) / 2;
        const values = durations.map(duration => minimum + Math.floor((duration - minimum) * fraction));
        if (layOut(values).finish <= dayFinish) low = fraction;
        else high = fraction;
      }
      scheduled = layOut(durations.map(duration => minimum + Math.floor((duration - minimum) * low)));
    }
    output.push(...scheduled.rows);
  }
  return output;
}
