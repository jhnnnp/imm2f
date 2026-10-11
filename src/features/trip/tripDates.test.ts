import { describe, expect, it } from "vitest";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import { hasTripContent, tripDateRange, tripDayOffset, tripDraftsWithActive, tripForDate, type TripDateSnapshot } from "./tripDates";

const item: PlanItem = { id: "cafe", placeId: "cafe", placeName: "우리 카페", category: "카페", memo: "", dayIndex: 0, order: 0, startTime: "13:00", durationMinutes: 60, expectedCost: 0 };
const active: CouplePlan = { persist: true, revision: 8, startDate: "2026-10-11", title: "부산 여행", notes: "체크인 16시", dayCount: 3, items: [item] };
const saved: TripDateSnapshot = { startDate: "2026-11-01", title: "제주 여행", notes: "바다", dayCount: 2, items: [{ ...item, id: "sea", placeName: "제주 바다" }], updatedAt: "2026-10-11T01:00:00Z" };

describe("viewing a travel date", () => {
  it("opens the requested saved trip while retaining the active global revision", () => {
    expect(tripForDate(active, [saved], saved.startDate)).toEqual({ ...saved, updatedAt: undefined, persist: true, revision: 8 });
  });
  it("shows an empty trip on an unused date without copying current places or notes", () => {
    expect(tripForDate(active, [saved], "2026-12-01")).toEqual({ persist: true, revision: 8, startDate: "2026-12-01", title: "우리가 고른 여행", notes: "", dayCount: 1, items: [] });
    expect(active.items).toHaveLength(1);
  });
  it("uses the active snapshot rather than an older draft of the same date", () => {
    expect(tripForDate(active, [{ ...saved, startDate: active.startDate! }], active.startDate!)).toBe(active);
  });
  it("preserves an undated trip and can return to it from a dated trip", () => {
    const undated = { ...saved, startDate: "" };
    expect(tripForDate(active, [undated], "")).toMatchObject({ startDate: null, title: saved.title, items: saved.items, revision: active.revision });
    expect(tripDraftsWithActive([saved], { ...active, startDate: null })).toHaveLength(2);
  });
  it("removes an obsolete active-date draft if the active trip was cleared", () => {
    expect(tripDraftsWithActive([{ ...saved, startDate: active.startDate! }, saved], { ...active, items: [], notes: "", title: "우리가 고른 여행" })).toEqual([saved]);
  });
  it("merges the active trip without dropping other dates or their concurrency stamp", () => {
    const drafts = tripDraftsWithActive([saved, { ...saved, startDate: active.startDate! }], active);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ ...active, updatedAt: saved.updatedAt });
    expect(drafts[1]).toEqual(saved);
  });
  it("includes titled and note-only trips, but excludes untouched placeholders", () => {
    expect(hasTripContent({ title: "우리가 고른 여행", notes: "", items: [] })).toBe(false);
    expect(hasTripContent({ title: "기념일 여행", notes: "", items: [] })).toBe(true);
    expect(hasTripContent({ title: "", notes: "숙소 예약", items: [] })).toBe(true);
  });
  it("includes every day across month boundaries and caps the supported seven days", () => {
    expect(tripDayOffset("2026-10-30", 3, "2026-11-01")).toBe(2);
    expect(tripDayOffset("2026-10-30", 3, "2026-11-02")).toBe(-1);
    expect(tripDayOffset("invalid", 3, "2026-11-01")).toBe(-1);
    expect(tripDayOffset("2026-10-30", 99, "2026-11-06")).toBe(-1);
    expect(tripDateRange("2026-10-30", 3)).toBe("2026-10-30 ~ 2026-11-01");
    expect(tripDateRange("", 3)).toBe("날짜 미정");
  });
});
