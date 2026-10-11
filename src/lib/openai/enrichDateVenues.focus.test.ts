import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { ResearchNeed } from "@/features/ai/researchPlan";
import { explorationVenueResearchFocus, matchesResearchIdentity, acceptVenueObservation } from "./enrichDateVenues";

const venue = (id: string, category: DiscoverCandidate["category"] = "restaurant"): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name: `장소 ${id}`, category,
  categoryLabel: "음식점", district: "영도구", address: "부산 영도구 동삼동 산 29-1",
  roadAddress: "", phone: "", mapUrl: "", coordinates: [129.08, 35.05],
});
const need = (overrides: Partial<ResearchNeed> = {}): ResearchNeed => ({
  id: "explore-meal", kind: "venue", purpose: "식당 방문 경험", category: "restaurant",
  geographicFocus: "부산", qualities: [], evidenceNeeded: [], priority: "required", ...overrides,
});

describe("exploration description research", () => {
  it("researches restaurant menus without optional atmosphere filters", () => {
    const result = explorationVenueResearchFocus([venue("1"), venue("2")], [need()]);
    expect([...result]).toEqual([["kakao:1", ["menu"]], ["kakao:2", ["menu"]]]);
  });

  it("matches the requested city in the full address rather than requiring it in district", () => {
    expect(explorationVenueResearchFocus([venue("1")], [need()]).size).toBe(1);
    expect(explorationVenueResearchFocus([{ ...venue("2"), address: "서울 성동구", district: "성동구" }], [need()]).size).toBe(0);
  });

  it("does not drop nature-classified lookouts from a tourist research need", () => {
    const result = explorationVenueResearchFocus([venue("1", "nature")], [need({
      id: "explore-nightview", category: "tourist", purpose: "야경 전망대 방문 경험",
    })]);
    expect(result.get("kakao:1")).toEqual(["experience"]);
  });

  it("keeps the bounded research budget independent of unlimited user selection", () => {
    expect(explorationVenueResearchFocus(Array.from({ length: 30 }, (_, index) => venue(String(index))),
      [need()], 2).size).toBe(2);
  });

  it("reuses fresh supported descriptions and researches the next undecorated branch", () => {
    const first = { ...venue("1"), evidence: [{ id: "1", venueId: "kakao:1",
      text: "대표 메뉴에는 직접 끓인 국물과 수제 면을 사용하는 요리가 있습니다.",
      url: "https://example.com/1", checkedAt: new Date().toISOString(),
      verification: "source_checked" as const, attribute: "menu" as const }] };
    const result = explorationVenueResearchFocus([first, venue("2"), venue("3")], [need()], 1);
    expect([...result.keys()]).toEqual(["kakao:2"]);
  });

  it("does not credit a stale or misattributed description", () => {
    const first = { ...venue("1"), evidence: [{ id: "1", venueId: "kakao:other",
      text: "대표 메뉴는 수제 면 요리입니다.", url: "https://example.com/1", checkedAt: new Date().toISOString(),
      verification: "source_checked" as const, attribute: "menu" as const }] };
    expect(explorationVenueResearchFocus([first], [need()]).size).toBe(1);
    expect(explorationVenueResearchFocus([{ ...first, evidence: [{ ...first.evidence[0],
      venueId: "kakao:1", checkedAt: "2020-01-01T00:00:00.000Z" }] }], [need()]).size).toBe(1);
  });

  it("prioritizes requested quality evidence over generic venue descriptions", () => {
    const result = explorationVenueResearchFocus([venue("1", "cafe")], [
      need({ id: "explore-cafe", category: "cafe" }),
      need({ id: "explore-cafe-evidence", kind: "evidence", category: "cafe",
        qualities: ["quiet"], evidenceNeeded: ["noise", "crowd"] }),
    ]);
    expect(result.get("kakao:1")).toEqual(["noise", "crowd", "space", "menu"]);
  });
});

describe("mountain lot branch identity", () => {
  it("matches a source's mountain lot while preserving lot identity", () => {
    const lookout = { ...venue("1", "tourist"), name: "태종대 전망대" };
    expect(matchesResearchIdentity(lookout, lookout.name, "부산광역시 영도구 동삼동 산29-1")).toBe(true);
    expect(matchesResearchIdentity(lookout, lookout.name, "부산 영도구 동삼동 29-1")).toBe(false);
    expect(matchesResearchIdentity(lookout, lookout.name, "부산 영도구 동삼동 산 29-10")).toBe(false);
    expect(matchesResearchIdentity(lookout, lookout.name, "부산 영도구 동삼동 산 29-1 1층")).toBe(true);
  });

  it("does not accept credential-bearing citation URLs", () => {
    const cafe = { ...venue("1", "cafe"), roadAddress: "부산 영도구 해양로 1", address: "" };
    const url = "https://user:password@example.com/cafe";
    expect(acceptVenueObservation(cafe, { text: "통창 옆 좌석에 전망 공간이 있습니다.", sourceUrl: url,
      sourceVenueName: cafe.name, sourceAddress: cafe.roadAddress,
      sourceExcerpt: "통창 옆 좌석에 전망 공간이 있습니다." }, [url])).toBeNull();
  });
});
