import { expect, it } from "vitest";
import { fitSchedule } from "./schedule";

it("uses verified legs from each day rather than replaying the first day's travel times", () => {
  const stops = [0, 0, 1, 1].map((dayIndex, index) => ({ id: index, dayIndex, durationMinutes: 60 }));
  const scheduled = fitSchedule(stops, "09:00", "17:00", "walk", {}, [1, 0, 120]);
  expect(scheduled?.map(stop => stop.startTime)).toEqual(["09:00", "10:01", "09:00", "12:00"]);
});

it("rejects an interleaved day when the available verified legs do not connect its stops", () => {
  const stops = [0, 1, 0, 1].map(dayIndex => ({ dayIndex, durationMinutes: 60 }));
  expect(fitSchedule(stops, "09:00", "17:00", "walk", {}, [1, 0, 120])).toBeNull();
});

it("refuses a later day whose own verified travel cannot fit its window", () => {
  const stops = [0, 0, 1, 1].map(dayIndex => ({ dayIndex, durationMinutes: 60 }));
  expect(fitSchedule(stops, "09:00", "12:00", "walk", {}, [1, 0, 150])).toBeNull();
});

it("waits for a night visit and keeps the rest of that day inside its window", () => {
  const scheduled = fitSchedule([{ id: "cafe", durationMinutes: 60 },
    { id: "night", durationMinutes: 60, earliestStartTime: "18:00" }], "10:00", "21:00", "drive", {}, [20]);
  expect(scheduled?.map(stop => stop.startTime)).toEqual(["10:00", "18:00"]);
});

it("compresses stays after a late earliest-start boundary and rejects an impossible boundary", () => {
  const stops = [{ durationMinutes: 120, earliestStartTime: "18:00" }, { durationMinutes: 120 }];
  const scheduled = fitSchedule(stops, "10:00", "20:00", "drive", {}, [20]);
  expect(scheduled?.map(stop => stop.startTime)).toEqual(["18:00", "19:10"]);
  expect(scheduled?.map(stop => stop.durationMinutes)).toEqual([50, 50]);
  expect(fitSchedule(stops, "10:00", "18:30", "drive", {}, [20])).toBeNull();
});

it("waits for opening, skips a break and uses actual travel before the next visit", () => {
  const scheduled = fitSchedule([
    { id: "cafe", durationMinutes: 60, visitWindows: [{ startMinutes: 11 * 60, endMinutes: 20 * 60 }] },
    { id: "meal", durationMinutes: 80, visitWindows: [{ startMinutes: 12 * 60, endMinutes: 15 * 60 },
      { startMinutes: 17 * 60, endMinutes: 21 * 60 }] },
  ], "10:00", "20:00", "walk", {}, [180]);
  expect(scheduled?.map(stop => stop.startTime)).toEqual(["11:00", "17:00"]);
});

it("compresses to fit a confirmed closing period and rejects a closed day", () => {
  const stop = { durationMinutes: 90, visitWindows: [{ startMinutes: 11 * 60, endMinutes: 12 * 60 }] };
  const scheduled = fitSchedule([stop], "09:00", "18:00");
  expect(scheduled?.[0].startTime).toBe("11:00");
  expect(scheduled?.[0].durationMinutes).toBe(60);
  expect(fitSchedule([{ durationMinutes: 60, visitWindows: [] }], "09:00", "18:00")).toBeNull();
});

it("rejects a arrival after the verified last-entry cutoff", () => {
  expect(fitSchedule([{ durationMinutes: 30, visitWindows: [{ startMinutes: 660, endMinutes: 1260,
    latestEntryMinutes: 1200 }] }], "20:01", "22:00")).toBeNull();
});
