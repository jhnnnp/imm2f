import { expect, it } from "vitest";
import { tripLocalWindows, unsupportedCourseRequest } from "./planningSupport";

it.each([
  "첫날 오후 7시 도착. 마지막 날 오후 2시 출발",
  "첫날 오후 7시 도착하고 마지막 날 오후 2시 출발",
  "1일차 19:00 도착; 3일차 14:00 출발",
])("pairs each movement with its own time: %s", request => {
  expect(tripLocalWindows([request], 3)).toEqual({ 0: { start: "19:00" }, 2: { end: "14:00" } });
});

it("does not treat an origin departure or an intermediate arrival as a local trip window", () => {
  expect(tripLocalWindows(["첫날 오전 7시 서울 출발. 첫날 오전 10시 부산 도착. 둘째 날 오후 2시 호텔 도착"], 3))
    .toEqual({ 0: { start: "10:00" } });
});

it("keeps earlier bounds and applies a later explicit correction", () => {
  expect(tripLocalWindows(["첫날 14:00 도착, 마지막 날 18:00 출발", "첫날 15:00 도착으로 바꿔줘"], 3))
    .toEqual({ 0: { start: "15:00" }, 2: { end: "18:00" } });
});

it("reads a half-hour and named evening clock without silently losing minutes", () => {
  expect(tripLocalWindows(["첫날 저녁 7시 반 도착. 마지막 날 오후 2시 15분 출발"], 3))
    .toEqual({ 0: { start: "19:30" }, 2: { end: "14:15" } });
});

it.each(["7박8일 말고 2박3일 부산 여행", "7박8일 취소하고 당일치기", "부산 2박3일로 바꿔줘, 7박8일은 취소"])(
  "does not reject a supported correction using the cancelled long duration: %s", request => {
    expect(unsupportedCourseRequest(request)).toBeNull();
  });

it("still rejects an unsupported final duration", () => {
  expect(unsupportedCourseRequest("부산 2박3일 말고 15박16일로 바꿔줘")).toContain("15박");
});
