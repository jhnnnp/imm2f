import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/features/planning/types/plan";
import { applyDateSwitch, hasDateContent, landingDateDay, nextUpcomingDate } from "./dateDays";

function stop(name: string): PlanItem {
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
    dayIndex: 0,
  };
}

describe("applyDateSwitch", () => {
  it("assigns an undated course to the first picked day", () => {
    const result = applyDateSwitch({
      current: { date: "", title: "우리가 고른 데이트", notes: "", items: [stop("KF XR 갤러리")] },
      drafts: [],
      nextDate: "2026-09-12",
    });
    expect(result.mode).toBe("assign");
    expect(result.focus.date).toBe("2026-09-12");
    expect(result.focus.items[0]?.placeName).toBe("KF XR 갤러리");
    expect(result.drafts).toHaveLength(1);
  });

  it("keeps Saturday when opening next week as a new day", () => {
    const saturday = { date: "2026-09-12", title: "우리가 고른 데이트", notes: "1시 만남", items: [stop("KF XR 갤러리")] };
    const result = applyDateSwitch({
      current: saturday,
      drafts: [saturday],
      nextDate: "2026-09-19",
    });
    expect(result.mode).toBe("switch");
    expect(result.focus.date).toBe("2026-09-19");
    expect(result.focus.items).toEqual([]);
    expect(result.drafts.find(day => day.date === "2026-09-12")?.items[0]?.placeName).toBe("KF XR 갤러리");
  });

  it("reopens a day that was already planned", () => {
    const saturday = { date: "2026-09-12", title: "우리가 고른 데이트", notes: "", items: [stop("KF XR 갤러리")] };
    const nextWeek = { date: "2026-09-19", title: "가을 데이트", notes: "", items: [stop("한강공원")] };
    const result = applyDateSwitch({
      current: saturday,
      drafts: [saturday, nextWeek],
      nextDate: "2026-09-19",
    });
    expect(result.focus.items[0]?.placeName).toBe("한강공원");
    expect(result.drafts.find(day => day.date === "2026-09-12")?.items).toHaveLength(1);
  });

  it("does not stash an empty day", () => {
    const result = applyDateSwitch({
      current: { date: "2026-09-12", title: "우리가 고른 데이트", notes: "", items: [] },
      drafts: [],
      nextDate: "2026-09-19",
    });
    expect(result.drafts.find(day => day.date === "2026-09-12")).toBeUndefined();
    expect(hasDateContent(result.focus)).toBe(false);
  });
});

describe("nextUpcomingDate", () => {
  it("prefers the soonest dated course from today", () => {
    const past = { date: "2026-09-01", title: "우리가 고른 데이트", notes: "", items: [stop("지난곳")] };
    const next = { date: "2026-09-19", title: "우리가 고른 데이트", notes: "", items: [stop("다음주")] };
    const current = { date: "2026-09-12", title: "우리가 고른 데이트", notes: "", items: [stop("오늘편집")] };
    expect(nextUpcomingDate([past, next, current], "2026-09-18", current).date).toBe("2026-09-19");
  });
});

describe("landingDateDay", () => {
  it("opens today instead of a past empty plan date", () => {
    const result = landingDateDay({
      plan: { startDate: "2026-08-22", title: "우리가 고른 데이트", notes: "", items: [] },
      drafts: [],
      today: "2026-09-18",
    });
    expect(result.focus.date).toBe("2026-09-18");
    expect(result.focus.items).toEqual([]);
    expect(result.drafts).toEqual([]);
  });

  it("keeps a past course marked while focusing today", () => {
    const result = landingDateDay({
      plan: { startDate: "2026-08-22", title: "우리가 고른 데이트", notes: "", items: [stop("지난카페")] },
      drafts: [],
      today: "2026-09-18",
    });
    expect(result.focus.date).toBe("2026-09-18");
    expect(result.focus.items).toEqual([]);
    expect(result.drafts.find(day => day.date === "2026-08-22")?.items[0]?.placeName).toBe("지난카페");
  });

  it("reopens today's draft when the saved plan is on another day", () => {
    const todayDraft = { date: "2026-09-18", title: "오늘 데이트", notes: "", items: [stop("서울숲")] };
    const result = landingDateDay({
      plan: { startDate: "2026-08-22", title: "우리가 고른 데이트", notes: "", items: [] },
      drafts: [todayDraft],
      today: "2026-09-18",
    });
    expect(result.focus.items[0]?.placeName).toBe("서울숲");
  });
});
