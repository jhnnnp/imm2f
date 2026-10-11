import { expect, it } from "vitest";
import { isNewerBoardVersion } from "./wallBoardVersion";

it("rejects duplicate and older snapshots arriving after a newer realtime update", () => {
  expect(isNewerBoardVersion("2026-10-11T12:00:01Z", "2026-10-11T12:00:02Z")).toBe(false);
  expect(isNewerBoardVersion("2026-10-11T12:00:02Z", "2026-10-11T12:00:02Z")).toBe(false);
  expect(isNewerBoardVersion("2026-10-11T12:00:03Z", "2026-10-11T12:00:02Z")).toBe(true);
});
it("distinguishes PostgreSQL microseconds within one JavaScript millisecond", () => {
  expect(isNewerBoardVersion("2026-10-11T12:00:02.123789+00:00", "2026-10-11T12:00:02.123456+00:00")).toBe(true);
  expect(isNewerBoardVersion("2026-10-11T12:00:02.123456+00:00", "2026-10-11T12:00:02.123789+00:00")).toBe(false);
});
it("compares equivalent offset and fractional representations consistently", () => {
  expect(isNewerBoardVersion("2026-10-11T21:00:02.123+09:00", "2026-10-11T12:00:02.123000Z")).toBe(false);
  expect(isNewerBoardVersion("2026-10-11T21:00:02.123456+09:00", "2026-10-11T12:00:02.123Z")).toBe(true);
});
it("requires a valid timestamp while accepting the first remote snapshot", () => {
  expect(isNewerBoardVersion("invalid", null)).toBe(false);
  expect(isNewerBoardVersion("2026-10-11T12:00:02Z", null)).toBe(true);
});
