import { describe, expect, it } from "vitest";
import { isLegacyDemoTripItem, stripLegacyDemoArchive, stripLegacyDemoPlan } from "./legacyDemo";
import type { CouplePlan, PlanItem } from "./types/plan";

function item(id: string, placeId = id): PlanItem {
  return {
    id,
    placeId,
    placeName: id,
    category: "산책",
    startTime: "10:00",
    durationMinutes: 60,
    expectedCost: 0,
    order: 0,
    memo: "",
    dayIndex: 0,
  };
}

function plan(items: PlanItem[], title = "군산에서 머문 이틀"): CouplePlan {
  const demo = title === "군산에서 머문 이틀";
  return {
    persist: true,
    revision: 1,
    items,
    title,
    notes: demo ? "근대 골목에서 시작해 섬의 노을로 끝나는 1박 2일" : "",
    startDate: demo ? "2026-10-14" : "2026-10-28",
    dayCount: 2,
  };
}

describe("legacy demo trip remnants", () => {
  it("recognizes seeded Gunsan / Jeonju / Busan stops", () => {
    expect(isLegacyDemoTripItem(item("gunsan-d1-1", "gunsan-history"))).toBe(true);
    expect(isLegacyDemoTripItem(item("jeonju-1", "jeonju-hanok"))).toBe(true);
    expect(isLegacyDemoTripItem(item("kakao-123", "18577297"))).toBe(false);
  });

  it("clears a demo-only live plan so the trip tab is empty", () => {
    const next = stripLegacyDemoPlan(plan([item("gunsan-d1-1", "gunsan-history"), item("gunsan-d2-1", "gunsan-railroad")]));
    expect(next.items).toEqual([]);
    expect(next.title).toBe("");
    expect(next.startDate).toBeNull();
    expect(next.dayCount).toBe(1);
    expect(next.notes).toBe("");
  });

  it("preserves a real database itinerary that reuses historical copy", () => {
    const museum = {
      ...item("8f1b2c3d-4e5f-6789-abcd-ef0123456789", "11111111-1111-1111-1111-111111111111"),
      placeName: "군산근대역사박물관",
      memo: "군산의 근대사와 항구 이야기를 먼저 살펴봐요.",
    };
    const next = stripLegacyDemoPlan(plan([museum]));
    expect(next.items).toEqual([museum]);
    expect(next.title).toBe("군산에서 머문 이틀");
  });

  it("keeps real stops when mixed with leftover demo rows", () => {
    const cafe = item("keep-1", "18577297");
    cafe.placeName = "로스터리요정";
    const next = stripLegacyDemoPlan(plan([item("gunsan-d1-2", "gunsan-chowon"), cafe], "군산 여행"));
    expect(next.items).toEqual([cafe]);
    expect(next.title).toBe("군산 여행");
  });

  it("keeps a real itinerary that retains the old demo title and notes", () => {
    const cafe = item("real-stop", "discover:kakao:18577297");
    const next = stripLegacyDemoPlan(plan([cafe]));
    expect(next.items).toEqual([cafe]);
    expect(next.title).toBe("군산에서 머문 이틀");
    expect(next.startDate).toBe("2026-10-14");
  });

  it("does not hide a real museum just because its trip title resembles a seed", () => {
    const museum = { ...item("real-stop", "discover:kakao:real"), placeName: "군산근대역사박물관", memo: "함께 예약한 전시" };
    expect(stripLegacyDemoPlan(plan([museum])).items).toEqual([museum]);
    expect(stripLegacyDemoArchive({ id: "real-archive", title: "군산에서 머문 이틀", items: [museum] })?.items).toEqual([museum]);
  });

  it("preserves an empty dated plan with a user title rather than guessing its origin", () => {
    const next = stripLegacyDemoPlan(plan([]));
    expect(next.title).toBe("군산에서 머문 이틀");
    expect(next.startDate).toBe("2026-10-14");
    expect(next.notes).toBe("근대 골목에서 시작해 섬의 노을로 끝나는 1박 2일");
  });

  it("drops archived demo journeys", () => {
    const demo = {
      id: "archive-busan-2024",
      title: "부산 바다의 이틀",
      startDate: "2024-05-03",
      dayCount: 2,
      status: "completed",
      items: [item("busan-1", "busan-huinnyeoul")],
    };
    expect(stripLegacyDemoArchive(demo)).toBeNull();
    expect(stripLegacyDemoArchive({ ...demo, id: "real", title: "군산에서 머문 이틀", items: [] })).not.toBeNull();
  });

  it("preserves customized stops that retained a historical client ID", () => {
    const real = { ...item("gunsan-d1-1", "discover:kakao:123"), placeName: "새로 고른 장소" };
    expect(stripLegacyDemoPlan(plan([real])).items).toEqual([real]);
  });
});
