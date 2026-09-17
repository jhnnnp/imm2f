import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/features/planning/types/plan";
import {
  DATE_KEEP_LABEL,
  TRIP_KEEP_LABEL,
  courseDayCount,
  courseKeepTitle,
  datesInRange,
  keepIntent,
  staySpanLabel,
  tripEndDate,
} from "./courseKeep";

function stop(name: string, dayIndex = 0): PlanItem {
  return {
    id: name,
    placeId: name,
    placeName: name,
    category: "카페",
    startTime: "13:00",
    durationMinutes: 60,
    expectedCost: 0,
    order: 0,
    memo: "",
    dayIndex,
  };
}

describe("courseKeep", () => {
  it("asks where to keep a confirmed course unless the destination is already named", () => {
    expect(keepIntent("이걸로 하자")).toBe("ask");
    expect(keepIntent("이 코스 담아줘")).toBe("ask");
    expect(keepIntent(DATE_KEEP_LABEL)).toBe("date");
    expect(keepIntent("데이트 코스로 저장해")).toBe("date");
    expect(keepIntent(TRIP_KEEP_LABEL)).toBe("trip");
    expect(keepIntent("여행에 담아줘")).toBe("trip");
    expect(keepIntent("카페만 바꿔줘")).toBeNull();
    expect(keepIntent("카페 변경 해줘")).toBeNull();
  });

  it("uses the longer of generated days and overnight length, capped at a week", () => {
    expect(courseDayCount([stop("카페")])).toBe(1);
    expect(courseDayCount([stop("카페", 0), stop("식당", 1)], 0)).toBe(2);
    expect(courseDayCount([stop("카페")], 2)).toBe(3);
    expect(courseDayCount([stop("카페", 8)], 9)).toBe(7);
  });

  it("turns a trip start date into a stay range", () => {
    expect(tripEndDate("2026-09-18", 1)).toBe("2026-09-18");
    expect(tripEndDate("2026-09-18", 3)).toBe("2026-09-20");
    expect(datesInRange("2026-09-18", 3)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(staySpanLabel(1)).toBe("당일");
    expect(staySpanLabel(3)).toBe("2박 3일");
  });

  it("names the saved plan from the course region", () => {
    expect(courseKeepTitle("date", "성수")).toBe("성수 데이트");
    expect(courseKeepTitle("trip", "제주")).toBe("제주 여행");
    expect(courseKeepTitle("trip", "")).toBe("우리가 고른 여행");
  });
});
