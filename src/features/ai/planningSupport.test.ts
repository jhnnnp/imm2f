import { describe, expect, it } from "vitest";
import { tripLocalWindows, unsupportedCourseRequest } from "./planningSupport";

describe("course support boundary", () => {
  it("does not silently shorten a four-day trip", () => {
    expect(unsupportedCourseRequest("군산 3박 4일 여행 코스")).toContain("임의로 2박으로 줄이지");
  });
  it("allows the supported spans", () => {
    expect(unsupportedCourseRequest("군산 당일치기")).toBeNull();
    expect(unsupportedCourseRequest("군산 1박2일")).toBeNull();
    expect(unsupportedCourseRequest("군산 2박 3일")).toBeNull();
  });
  it("makes an overseas itinerary request explicit", () => {
    expect(unsupportedCourseRequest("오사카 1박2일 여행")).toContain("국내 코스");
    expect(unsupportedCourseRequest("군산 일본식 가옥 데이트")).toBeNull();
    expect(unsupportedCourseRequest("홍콩반점에서 데이트 코스")).toBeNull();
    expect(unsupportedCourseRequest("파리바게뜨에서 카페 데이트 코스")).toBeNull();
  });
});

describe("explicit trip day windows", () => {
  it("constrains arrival and departure days without inventing travel legs", () => {
    expect(tripLocalWindows(["첫날 오후 2시 도착, 둘째 날 오후 5시 출발"], 2))
      .toEqual({ 0: { start: "14:00" }, 1: { end: "17:00" } });
  });
  it("does not treat ordinary appointment times as arrival or departure", () => {
    expect(tripLocalWindows(["첫날 오후 2시 박물관 관람"], 2)).toEqual({});
    expect(tripLocalWindows(["첫날 2시 도착"], 2)).toEqual({});
    expect(tripLocalWindows(["첫날 오후 5시 출발"], 2)).toEqual({});
  });
});
