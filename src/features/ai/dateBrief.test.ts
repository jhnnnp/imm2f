import { describe, expect, it } from "vitest";
import {
  DATE_AREA_OPTIONS,
  applyDateDefaults,
  courseSize,
  discoveryActivities,
  emptyDateBrief,
  extractAreasFromText,
  extractCuisine,
  extractStay,
  extractTimeWindow,
  matchesIndoorType,
  missingSlot,
  expandedSearchRegions,
  searchIntents,
  withAreas,
} from "./dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";

function candidate(overrides: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    externalSource: "kakao",
    externalPlaceId: "1",
    name: "코드케이 성수",
    category: "tourist",
    categoryLabel: "문화시설",
    district: "성수",
    address: "",
    roadAddress: "",
    phone: "",
    mapUrl: "",
    coordinates: [127.056, 37.544],
    detailedCategory: "문화,예술 > 방탈출카페",
    ...overrides,
  };
}

describe("dateBrief", () => {
  it("does not force cafe+meal+walk onto an empty brief", () => {
    const next = applyDateDefaults(emptyDateBrief());
    expect(next.activities).toEqual([]);
    expect(next.areaScope).toBe("nearby");
  });

  it("opens a mixed discovery pool when activities are empty", () => {
    const state = applyDateDefaults(withAreas(emptyDateBrief(), ["성수"]));
    expect(discoveryActivities(state)).toEqual(["cafe", "meal", "walk", "exhibit"]);
    expect(searchIntents(state).some(intent => intent.category === "cafe")).toBe(true);
    expect(searchIntents(state).some(intent => intent.category === "photo")).toBe(true);
  });

  it("extracts dish-based cuisine and known neighborhoods outside the old whitelist", () => {
    expect(extractCuisine("파스타 먹고 싶어")).toBe("양식");
    expect(extractCuisine("라멘 먹자")).toBe("일식");
    expect(extractAreasFromText("판교에서 데이트하고 싶어")).toContain("판교");
    expect(extractAreasFromText("문래 한 바퀴")).toContain("문래");
  });

  it("does not treat dinner food talk as an evening time window", () => {
    expect(extractTimeWindow("저녁 먹고 싶어")).toBeNull();
    expect(extractTimeWindow("저녁부터 시작하고 싶어")).toBe("evening");
  });

  it("asks stay length then meeting time before planning a date", () => {
    const withArea = withAreas(emptyDateBrief(), ["을지로"]);
    expect(missingSlot(withArea)).toBe("span");
    expect(extractStay("성수에서 데이트하고 싶어")).toEqual({ stayKind: "date", nights: 0 });
    expect(extractStay("군산 1박2일")).toEqual({ stayKind: "overnight", nights: 1 });
    expect(courseSize({ ...withArea, stayKind: "date", timeWindow: "evening" }).min).toBe(2);
    expect(courseSize({ ...withArea, stayKind: "date", timeWindow: "afternoon" }).min).toBe(3);
    expect(courseSize({ ...withArea, stayKind: "overnight", nights: 1 }).min).toBe(6);
  });

  it("keeps 을지로 as the keyword hub and searches date-like meals", () => {
    const state = applyDateDefaults(withAreas(emptyDateBrief(), ["을지로"]));
    expect(expandedSearchRegions(state)).toEqual(expect.arrayContaining(["을지로", "익선동", "청계천", "충무로"]));
    expect(searchIntents(state).every(intent => intent.region === "을지로")).toBe(true);
    expect(searchIntents(state).some(intent => intent.query === "파스타")).toBe(true);
    expect(searchIntents(state).some(intent => intent.query === "브런치")).toBe(true);
    expect([...DATE_AREA_OPTIONS]).toContain("을지로");
  });

  it("matches indoor venues by category path, not shop name", () => {
    expect(matchesIndoorType(candidate(), "방탈출")).toBe(true);
    expect(matchesIndoorType(candidate({ name: "레드버튼", detailedCategory: "레저 > 보드게임카페" }), "보드게임")).toBe(true);
    expect(matchesIndoorType(candidate(), "볼링")).toBe(false);
  });
});
