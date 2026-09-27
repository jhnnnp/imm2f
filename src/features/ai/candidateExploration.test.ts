import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { buildDateContext } from "./dateContext";
import { buildExperiencePlanInput } from "./experiencePlan";
import { emptySessionCandidates, markExplorationCandidates, mergeSessionCandidates } from "./sessionCandidates";
import { candidateQualityBadges, explorationPrompt, explorationResearchPlan,
  groupExplorationCandidates, initialExplorationPreferences, refineExplorationNeed,
  refinementGroupForMessage,
  type CandidateExplorationPreferences } from "./candidateExploration";

const state = withAreas(emptyDateBrief(), ["부산"]);
const now = new Date().toISOString();
const venue = (id: number, category: DiscoverCandidate["category"] = "cafe",
  name = `카페 ${id}`): DiscoverCandidate => ({ externalSource: "kakao", externalPlaceId: String(id),
  name, category, categoryLabel: category === "cafe" ? "카페" : "음식점",
  district: "부산 해운대구", address: `부산 해운대구 ${id}번지`, roadAddress: "",
  mapUrl: `https://place.map.kakao.com/${id}`, phone: "", coordinates: [129.16, 35.16],
  kakaoCategoryGroupCode: category === "cafe" ? "CE7" : "FD6" });
const prefs = (activities: CandidateExplorationPreferences["activities"]): CandidateExplorationPreferences => ({
  activities, cafeQualities: [], cuisine: null, shoppingKind: null, cultureKind: null,
  pace: "balanced", provenance: {},
});

describe("P3.25 candidate exploration", () => {
  it("retains explicit area, duration and cafe qualities without adding meal or walk", () => {
    const trip = { ...state, stayKind: "overnight" as const, nights: 2 };
    const choices = initialExplorationPreferences("부산 2박3일 예쁜 오션뷰 카페", trip);
    expect(choices.activities).toEqual(["cafe"]);
    expect(choices.cafeQualities).toEqual(["aesthetic", "view"]);
    const prompt = explorationPrompt("부산 2박3일", choices);
    expect(prompt).toContain("예쁜 공간, 오션뷰/전망");
    expect(buildExperiencePlanInput(prompt, trip,
      buildDateContext({ state: trip, observedAt: now })).qualitativeNeeds)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "cafe", dimension: "aesthetic" }),
        expect.objectContaining({ category: "cafe", dimension: "scenic" }),
      ]));
    const research = explorationResearchPlan(null, choices, "부산");
    expect(research.needs.filter(need => need.kind === "venue")).toEqual([
      expect.objectContaining({ category: "cafe", qualities: ["aesthetic", "view"],
        evidenceNeeded: expect.arrayContaining(["space", "interior", "view"]) }),
    ]);
  });

  it("makes seafood an explicit meal need, without unrelated groups", () => {
    const options = { ...prefs(["meal"]), cuisine: "해산물" };
    const research = explorationResearchPlan(null, options, "부산");
    expect(research.needs.filter(need => need.kind === "venue")).toEqual([
      expect.objectContaining({ purpose: "해산물 식당 방문 경험", category: "restaurant" }),
    ]);
    const groups = groupExplorationCandidates({ plan: research, preferences: options,
      candidates: [venue(1, "restaurant", "해산물 식당"), venue(2, "restaurant", "피자 가게")], session: null });
    expect(groups[0].cards.map(card => card.name)).toEqual(["해산물 식당"]);
  });

  it("returns only five eligible candidates and never fills eight with rejected rows", () => {
    const options = prefs(["cafe"]);
    const research = explorationResearchPlan(null, options, "부산");
    const candidates = Array.from({ length: 6 }, (_, index) => venue(index + 1));
    const hard = { ...state, excludedPlaces: ["카페 6"] };
    const pool = buildDateCandidatePool(candidates, hard);
    const groups = groupExplorationCandidates({ plan: research, preferences: options,
      candidates: pool.eligible, session: null });
    expect(pool.records.find(item => item.venue.name === "카페 6")?.rejectedReasons).toContain("excluded_place");
    expect(groups[0].cards).toHaveLength(5);
    expect(groups[0].cards.every(card => card.name !== "카페 6")).toBe(true);
  });

  it("caps a group at eight and keeps already shown, selected and rejected venues out of the next page", () => {
    const options = prefs(["cafe"]);
    const research = explorationResearchPlan(null, options, "부산");
    const candidates = Array.from({ length: 12 }, (_, index) => venue(index + 1));
    const pool = buildDateCandidatePool(candidates, state);
    const initial = mergeSessionCandidates(null, pool.records, { sessionId: "s", observedAt: now, turnId: "s:1" });
    const marked = markExplorationCandidates(initial, { shownIds: ["kakao:1", "kakao:2"],
      selectedIds: ["kakao:1"], rejectedIds: ["kakao:2"], turnId: "s:shown", observedAt: now });
    const next = groupExplorationCandidates({ plan: research, preferences: options,
      candidates: pool.eligible, session: marked });
    expect(next[0].cards).toHaveLength(8);
    expect(next[0].cards.map(card => card.candidateId)).not.toContain("kakao:1");
    expect(next[0].cards.map(card => card.candidateId)).not.toContain("kakao:2");
    expect(marked.selectedCandidateIds).toContain("kakao:1");
    expect(marked.rejectedCandidateIds).toContain("kakao:2");
  });

  it("refines only one ResearchNeed; subjective local feel never becomes a badge", () => {
    const options = prefs(["cafe", "meal"]);
    const original = explorationResearchPlan(null, options, "부산");
    const refined = refineExplorationNeed(original, "cafe", "조용하고 현지 느낌 나는 곳");
    expect(refined.needs.find(need => need.id === "explore-cafe")?.qualities).toEqual(["quiet", "local_feel"]);
    expect(refined.needs.find(need => need.id === "explore-meal")).toEqual(original.needs.find(need => need.id === "explore-meal"));
    const place = { ...venue(1), evidence: [{ id: "f", text: "현지 느낌이라는 후기", url: "https://example.com/f",
      checkedAt: now, attribute: "space" as const, venueId: "kakao:1", verification: "source_checked" as const }] };
    expect(candidateQualityBadges(place, refined.needs.find(need => need.id === "explore-cafe")!)).toEqual([]);
  });

  it("applies an unqualified follow-up only to the active candidate group", () => {
    const options = prefs(["beach", "cafe"]);
    const groups = groupExplorationCandidates({ plan: explorationResearchPlan(null, options, "부산"),
      preferences: options, candidates: [], session: null });
    expect(refinementGroupForMessage(groups, "좀 덜 비싼 곳", "cafe")).toBe("cafe");
    expect(refinementGroupForMessage(groups, "좀 덜 비싼 곳", null)).toBeNull();
    expect(refinementGroupForMessage(groups, "다른 해변", "cafe")).toBe("beach");
  });

  it("never labels a place quiet from missing or negative noise evidence", () => {
    const need = refineExplorationNeed(explorationResearchPlan(null, prefs(["cafe"]), "부산"),
      "cafe", "조용한 곳").needs[0];
    expect(candidateQualityBadges(venue(1), need)).toEqual([]);
    expect(candidateQualityBadges({ ...venue(1), evidence: [{ id: "f", text: "시끄럽고 붐비는 카페",
      url: "https://example.com/f", checkedAt: now, attribute: "space", venueId: "kakao:1",
      verification: "source_checked" }] }, need)).toEqual([]);
  });

  it("shows a quality badge only from fresh verified evidence for that venue", () => {
    const options = { ...prefs(["cafe"]), cafeQualities: ["aesthetic"] as CandidateExplorationPreferences["cafeQualities"] };
    const need = explorationResearchPlan(null, options, "부산").needs[0];
    const evidence = { id: "space-1", text: "감각적인 인테리어가 있는 카페", url: "https://example.com/cafe",
      checkedAt: now, attribute: "space" as const, venueId: "kakao:1", verification: "source_checked" as const };
    expect(candidateQualityBadges({ ...venue(1), evidence: [evidence] }, need)).toEqual(["예쁜 공간"]);
    expect(candidateQualityBadges({ ...venue(2), evidence: [evidence] }, need)).toEqual([]);
    expect(candidateQualityBadges({ ...venue(1), evidence: [{ ...evidence,
      checkedAt: "2020-01-01T00:00:00.000Z" }] }, need)).toEqual([]);
  });

  it("retains explicit selection provenance and session-only rejection events", () => {
    const options = initialExplorationPreferences("카페만 가고 싶어", state);
    expect(options.provenance.cafe).toBe("explicit_text");
    const detailed = initialExplorationPreferences("아울렛 쇼핑하고 미술관도 가고 싶어", state);
    expect(detailed.shoppingKind).toBe("outlet");
    expect(detailed.cultureKind).toBe("art_museum");
    expect(detailed.provenance.shoppingKind).toBe("explicit_text");
    expect(explorationPrompt("부산 1박2일", detailed)).toContain("쇼핑 종류: 아울렛");
    const session = emptySessionCandidates("new-planning-session");
    expect(session.records).toEqual([]);
  });
});
