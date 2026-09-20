import { distanceMeters } from "@/features/places/geo";

type Stop = { durationMinutes: number; coordinates?: [number, number] | null; dayIndex?: number };
export const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const formatClock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function scheduleGapMinutes(from?: [number, number] | null, to?: [number, number] | null) {
  if (!from || !to) return 0;
  const meters = distanceMeters(from, to);
  return meters < 120 ? 0 : Math.max(8, Math.ceil(meters / 80));
}

/** Schedule each day independently. Never publish a course outside the agreed window. */
export function fitSchedule<T extends Stop>(stops: T[], start: string, end: string): Array<T & { startTime: string }> | null {
  if (![start, end].every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;
  const begin = clockMinutes(start);
  let finish = clockMinutes(end);
  if (finish <= begin) finish += 24 * 60;
  const output: Array<T & { startTime: string }> = [];
  const days = [...new Set(stops.map(stop => Math.max(0, Math.floor(stop.dayIndex ?? 0))))].sort((a, b) => a - b);
  for (const day of days) {
    const group = stops.filter(stop => Math.max(0, Math.floor(stop.dayIndex ?? 0)) === day);
    const gaps = group.map((stop, index) => index ? scheduleGapMinutes(group[index - 1].coordinates, stop.coordinates) : 0);
    const available = finish - begin - gaps.reduce((a, b) => a + b, 0);
    const minimum = 30;
    if (available < minimum * group.length) return null;
    const durations = group.map(stop => Math.max(minimum, Math.min(180, Math.round(stop.durationMinutes) || 60)));
    const desired = durations.reduce((a, b) => a + b, 0);
    if (desired > available) {
      const flexible = desired - minimum * group.length;
      const allowance = available - minimum * group.length;
      durations.forEach((duration, index) => { durations[index] = minimum + Math.floor((duration - minimum) * allowance / flexible); });
    }
    let cursor = begin;
    group.forEach((stop, index) => {
      cursor += gaps[index];
      output.push({ ...stop, dayIndex: day, startTime: formatClock(cursor), durationMinutes: durations[index] });
      cursor += durations[index];
    });
  }
  return output;
}
