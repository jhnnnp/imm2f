import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { buildDateContext } from "./dateContext";
import { buildExperiencePlanInput } from "./experiencePlan";
import { emptySessionCandidates, markExplorationCandidates, mergeSessionCandidates } from "./sessionCandidates";
import { candidateCardFact, candidateQualityBadges, explorationPrompt, explorationResearchPlan,
  explorationGroupMatch, explorationSearchQueries, explorationStateForActivities, groupExplorationCandidates,
  initialExplorationPreferences, refineExplorationNeed, retainExplorationChoices,
  refinementGroupForMessage, validExplorationPreferences,
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
  activities, cafeQualities: [], cuisines: [], shoppingKinds: [], cultureKinds: [], additionalDetails: "",
  pace: "balanced", provenance: {},
});

describe("P3.25 candidate exploration", () => {
  it("keeps discovery interests separate from explicit itinerary requirements", () => {
    const initial = { ...state, explicitPlanningSelections: { activities: ["exhibit" as const] } };
    const interest = explorationStateForActivities(initial, prefs(["cafe", "meal"]));
    expect(interest.activities).toEqual(["exhibit", "cafe", "meal"]);
    expect(interest.explicitPlanningSelections?.activities).toEqual(["exhibit"]);
  });

  it("removes selected and rejected choices only when their group is removed", () => {
    const selectedCards = [{ candidateId: "kakao:cafe" }, { candidateId: "kakao:exhibit" }];
    const kept = retainExplorationChoices({ selectedCards, rejectedIds: ["kakao:bad-cafe", "kakao:bad-meal"],
      groupById: { "kakao:cafe": "cafe", "kakao:exhibit": "culture",
        "kakao:bad-cafe": "cafe", "kakao:bad-meal": "meal" }, activities: ["culture", "meal"] });
    expect(kept.selectedCards).toEqual([selectedCards[1]]);
    expect(kept.rejectedIds).toEqual(["kakao:bad-meal"]);
  });
  it("ranks eligible places by query agreement and provider relevance without a beach quota", () => {
    const options = prefs(["beach"]);
    const plan = explorationResearchPlan(null, options, "부산");
    const names = ["해운대해수욕장", "광안리해수욕장", "송정해수욕장", "다대포해수욕장",
      "송도해수욕장", "일광해수욕장", "임랑해수욕장", "감지해변", "청사포몽돌해변",
      "이기대해안산책로", "동백공원 해안산책로", "부산 바닷길"];
    const candidates = names.map((name, index) => ({ ...venue(index + 301, "nature", name),
      detailedCategory: name.includes("산책로") ? "여행 > 관광,명소 > 도보여행"
        : "여행 > 관광,명소 > 해수욕장,해변" }));
    const pool = buildDateCandidatePool(candidates, state);
    const signals = Object.fromEntries(candidates.map((candidate, index) => [
      `kakao:${candidate.externalPlaceId}`, { matchedQueries: index === 0 ? 3 : 1,
        primaryRank: index === 0 ? 0 : index, bestRank: index === 0 ? 0 : index },
    ]));
    const groups = groupExplorationCandidates({ plan, preferences: options, candidates: pool.eligible,
      records: pool.records, session: null,
      retrievalSignalsByGroup: { beach: signals },
      candidateIdsByGroup: { beach: candidates.map(candidate => `kakao:${candidate.externalPlaceId}`) } });
    expect(groups[0].cards).toHaveLength(8);
    expect(groups[0].cards[0].name).toBe("해운대해수욕장");
    expect(groups[0].availableCount).toBe(12);

    const excluded = buildDateCandidatePool(candidates, { ...state, excludedPlaces: ["해운대해수욕장"] });
    const safe = groupExplorationCandidates({ plan, preferences: options, candidates: excluded.eligible,
      records: excluded.records, session: null,
      candidateIdsByGroup: { beach: candidates.map(candidate => `kakao:${candidate.externalPlaceId}`) } });
    expect(safe[0].cards.some(card => card.name === "해운대해수욕장")).toBe(false);
  });

  it("applies the same retrieval criteria to cafes, ahead of alphabetical order", () => {
    const options = prefs(["cafe"]);
    const plan = explorationResearchPlan(null, options, "부산");
    const firstAlphabetically = venue(601, "cafe", "가 카페");
    const betterRetrieved = venue(602, "cafe", "하 카페");
    const groups = groupExplorationCandidates({ plan, preferences: options,
      candidates: [firstAlphabetically, betterRetrieved], session: null,
      retrievalSignalsByGroup: { cafe: {
        "kakao:601": { matchedQueries: 1, primaryRank: 5, bestRank: 5 },
        "kakao:602": { matchedQueries: 2, primaryRank: 1, bestRank: 1 },
      } } });
    expect(groups[0].cards.map(card => card.name)).toEqual(["하 카페", "가 카페"]);
  });

  it("deduplicates after ranking so the better retrieved record represents a place", () => {
    const options = prefs(["cafe"]);
    const plan = explorationResearchPlan(null, options, "부산");
    const stale = venue(611, "cafe", "같은 카페");
    const better = { ...venue(612, "cafe", "같은 카페"), address: stale.address };
    const groups = groupExplorationCandidates({ plan, preferences: options,
      candidates: [stale, better], session: null,
      retrievalSignalsByGroup: { cafe: {
        "kakao:612": { matchedQueries: 2, primaryRank: 0, bestRank: 0 },
      } } });
    expect(groups[0].cards.map(card => card.candidateId)).toEqual(["kakao:612"]);
  });

  it("prioritizes verified requested qualities over provider order", () => {
    const options = { ...prefs(["cafe"]),
      cafeQualities: ["aesthetic"] as CandidateExplorationPreferences["cafeQualities"] };
    const plan = explorationResearchPlan(null, options, "부산");
    const first = venue(501);
    const supported = { ...venue(502), evidence: [{ id: "space-502",
      text: "감각적인 인테리어가 있는 카페", url: "https://example.com/cafe",
      checkedAt: now, attribute: "space" as const, venueId: "kakao:502",
      verification: "source_checked" as const }] };
    const groups = groupExplorationCandidates({ plan, preferences: options,
      candidates: [first, supported], session: null,
      candidateIdsByGroup: { cafe: ["kakao:501", "kakao:502"] } });
    expect(groups[0].cards[0].name).toBe(supported.name);
  });

  it("searches shopping and night views with relevant variants while keeping beach and nature distinct", () => {
    expect(explorationSearchQueries("shopping", "쇼핑")).toContain("쇼핑몰");
    expect(explorationSearchQueries("shopping", "쇼핑", "전주")).toContain("소품샵");
    expect(explorationSearchQueries("shopping", "아울렛", "전주")).toContain("상설할인매장");
    expect(explorationSearchQueries("shopping", "쇼핑", "왕십리")).toContain("왕십리역 상가");
    expect(explorationSearchQueries("shopping", "쇼핑", "서울")).not.toContain("서울역 상가");
    expect(explorationSearchQueries("nightview", "야경 전망대")).toContain("야경 명소");
    const mall = { ...venue(91, "tourist", "엔터식스 왕십리역점"),
      detailedCategory: "쇼핑 > 쇼핑몰", kakaoCategoryGroupCode: "MT1" };
    expect(explorationGroupMatch(mall, "shopping")).toBe(true);
    expect(explorationGroupMatch({ ...mall, name: "나르본느",
      detailedCategory: "통신판매 > 인터넷쇼핑몰" }, "shopping")).toBe(false);
    expect(explorationGroupMatch({ ...mall, name: "세계주류백화점",
      detailedCategory: "식품 > 주류도매,주류유통" }, "shopping")).toBe(false);
    expect(explorationGroupMatch({ ...mall, name: "왕십리도선동상점가 고객센터",
      detailedCategory: "가정,생활 > 시장" }, "shopping")).toBe(false);
    expect(explorationGroupMatch({ ...mall, name: "휴대폰백화점",
      detailedCategory: "전자제품 > 휴대폰판매" }, "shopping")).toBe(false);
    expect(explorationGroupMatch({ ...mall, name: "전주한섬아울렛",
      detailedCategory: "가정,생활 > 상설할인매장" }, "shopping")).toBe(true);
    expect(explorationGroupMatch({ ...mall, name: "아파트 상가동",
      detailedCategory: "가정,생활 > 상가,아케이드 > 아파트상가" }, "shopping")).toBe(false);
    expect(explorationGroupMatch({ ...mall, name: "무지개쇼핑",
      detailedCategory: "가정,생활 > 슈퍼마켓" }, "shopping")).toBe(false);
    expect(explorationGroupMatch(mall, "nightview")).toBe(false);
    const beach = { ...venue(92, "nature", "해운대해수욕장"), categoryLabel: "관광명소" };
    expect(explorationGroupMatch(beach, "beach")).toBe(true);
    expect(explorationGroupMatch(beach, "nature")).toBe(false);
    const park = { ...venue(93, "nature", "부산시민공원"), categoryLabel: "관광명소" };
    expect(explorationGroupMatch(park, "nature")).toBe(true);
    expect(explorationGroupMatch(park, "beach")).toBe(false);
    const night = { ...venue(94, "tourist", "황령산 전망대"), categoryLabel: "관광명소" };
    expect(explorationGroupMatch(night, "nightview")).toBe(true);
  });

  it("keeps nearby physical shopping venues and drops distant or online results", () => {
    const options = prefs(["shopping"]);
    const plan = explorationResearchPlan(null, options, "왕십리");
    const physical = { ...venue(201, "tourist", "엔터식스 왕십리역점"),
      detailedCategory: "가정,생활 > 상가,아케이드 > 엔터식스",
      coordinates: [127.038, 37.561] as [number, number] };
    const nearbyMarket = { ...venue(202, "tourist", "행당시장"),
      detailedCategory: "가정,생활 > 시장", coordinates: [127.0327, 37.5601] as [number, number] };
    const distantMall = { ...venue(203, "tourist", "멀리 있는 쇼핑몰"),
      detailedCategory: "가정,생활 > 복합쇼핑몰", coordinates: [127.12, 37.60] as [number, number] };
    const adjacentDistrictMall = { ...venue(206, "tourist", "인접 상권 쇼핑몰"),
      detailedCategory: "가정,생활 > 복합쇼핑몰", coordinates: [127.053, 37.568] as [number, number] };
    const online = { ...venue(204, "tourist", "온라인상점"),
      detailedCategory: "통신판매 > 인터넷쇼핑몰", coordinates: [127.03, 37.56] as [number, number] };
    const groups = groupExplorationCandidates({ plan, preferences: options,
      candidates: [physical, nearbyMarket, adjacentDistrictMall, distantMall, online], session: null,
      searchCenter: [127.0255, 37.5679] });
    expect(groups[0].cards.map(card => card.name)).toEqual(["엔터식스 왕십리역점", "행당시장"]);
  });

  it("accepts provider discount-store taxonomy for an explicit outlet choice", () => {
    const options = { ...prefs(["shopping"]),
      shoppingKinds: ["outlet"] as CandidateExplorationPreferences["shoppingKinds"] };
    const plan = explorationResearchPlan(null, options, "전주");
    const outlet = { ...venue(205, "tourist", "서전주아울렛"),
      district: "전주시 완산구", address: "전북특별자치도 전주시 완산구 효자동",
      detailedCategory: "가정,생활 > 상설할인매장" };
    const groups = groupExplorationCandidates({ plan, preferences: options,
      candidates: [outlet], session: null });
    expect(groups[0].cards.map(card => card.name)).toEqual(["서전주아울렛"]);
  });

  it("retains explicit area, duration and cafe qualities without adding meal or walk", () => {
    const trip = { ...state, stayKind: "overnight" as const, nights: 2 };
    const choices = initialExplorationPreferences("부산 2박3일 예쁜 오션뷰 카페", trip);
    expect(choices.activities).toEqual(["cafe"]);
    expect(choices.cafeQualities).toEqual(["aesthetic", "view"]);
    const prompt = explorationPrompt("부산 2박3일", choices);
    expect(prompt).toContain("공간이 예쁜 곳, 전망 좋은 곳");
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
    const options = { ...prefs(["meal"]), cuisines: ["해산물"] };
    const research = explorationResearchPlan(null, options, "부산");
    expect(research.needs.filter(need => need.kind === "venue")).toEqual([
      expect.objectContaining({ purpose: "해산물 식당 방문 경험", category: "restaurant" }),
    ]);
    const groups = groupExplorationCandidates({ plan: research, preferences: options,
      candidates: [venue(1, "restaurant", "해산물 식당"), venue(2, "restaurant", "피자 가게")], session: null });
    expect(groups[0].cards.map(card => card.name)).toEqual(["해산물 식당"]);
  });

  it("accepts multiple detail choices as alternatives and keeps an inland view preference generic", () => {
    const options = { ...prefs(["meal", "shopping", "culture", "cafe"]),
      cuisines: ["한식", "일식"], shoppingKinds: ["outlet", "market"] as CandidateExplorationPreferences["shoppingKinds"],
      cultureKinds: ["museum", "exhibit"] as CandidateExplorationPreferences["cultureKinds"],
      cafeQualities: ["view"] as CandidateExplorationPreferences["cafeQualities"],
      additionalDetails: "서울에서 조용한 카페" };
    expect(validExplorationPreferences(options)).toBe(true);
    const prompt = explorationPrompt("서울 데이트", options);
    expect(prompt).toContain("전망 좋은 카페");
    expect(prompt).not.toContain("오션뷰 카페");
    const plan = explorationResearchPlan(null, options, "서울");
    expect(plan.needs.find(need => need.id === "explore-cafe")?.qualities).toEqual(["view", "quiet"]);
    expect(plan.needs.find(need => need.id === "explore-meal")?.purpose).toBe("식당 방문 경험");
    const groups = groupExplorationCandidates({ plan, preferences: options,
      candidates: [venue(11, "restaurant", "한식당"), venue(12, "restaurant", "일식당"),
        venue(13, "restaurant", "파스타집")], session: null });
    expect(groups.find(group => group.id === "meal")?.cards.map(card => card.name)).toEqual(["일식당", "한식당"]);
    expect(validExplorationPreferences({ ...options, cuisines: ["한식", "한식"] })).toBe(false);
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
    expect(candidateQualityBadges({ ...venue(1), evidence: [{ id: "g",
      text: "붐비지 않아 조용히 대화하기 좋은 공간", url: "https://example.com/g",
      checkedAt: now, attribute: "space", venueId: "kakao:1",
      verification: "source_checked" }] }, need)).toEqual(["조용함"]);
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

  it("shows checked evidence or provider identity details without inventing a venue trait", () => {
    const walkway = venue(20, "tourist", "동백공원 해안산책로");
    expect(candidateCardFact(walkway)).toEqual({ label: "장소 유형",
      text: "해안 산책로" });
    expect(candidateCardFact({ ...walkway, detailedCategory: "여행 > 관광명소 > 산책로" }))
      .toEqual({ label: "장소 유형", text: "산책로" });
    const evidence = { id: "checked", text: "해안을 따라 걷는 산책 구간", url: "https://example.com/walk",
      checkedAt: now, attribute: "experience" as const, venueId: "kakao:20",
      verification: "source_checked" as const };
    expect(candidateCardFact({ ...walkway, evidence: [evidence] })).toEqual({
      label: "확인된 정보", text: "해안을 따라 걷는 산책 구간" });
    expect(candidateCardFact({ ...walkway, evidence: [{ ...evidence,
      checkedAt: "2020-01-01T00:00:00.000Z" }] }).label).toBe("장소 유형");
    expect(candidateCardFact({ ...walkway, evidence: [{ ...evidence,
      venueId: "kakao:other" }] }).label).toBe("장소 유형");
    const reported = { ...evidence, id: "reported", verification: "search_report" as const,
      sourceExcerpt: "해안을 따라 걷는 산책 구간", sourceVenueName: walkway.name,
      sourceAddress: walkway.address };
    expect(candidateCardFact({ ...walkway, evidence: [reported] })).toEqual({
      label: "검색 자료 · 확인 필요", text: "해안을 따라 걷는 산책 구간" });
    expect(candidateCardFact({ ...walkway, evidence: [{ ...reported,
      sourceExcerpt: "" }] }).label).toBe("장소 유형");
  });

  it("puts the requested quality evidence ahead of unrelated menu evidence", () => {
    const cafe = venue(51);
    const need = explorationResearchPlan(null, { ...prefs(["cafe"]), cafeQualities: ["aesthetic"] }, "부산")
      .needs.find(item => item.kind === "evidence")!;
    const evidence = (attribute: "menu" | "space", text: string) => ({ id: attribute, text,
      url: `https://example.com/${attribute}`, checkedAt: now, attribute,
      venueId: "kakao:51", verification: "source_checked" as const });
    expect(candidateCardFact({ ...cafe, evidence: [
      evidence("menu", "대표 디저트는 케이크"), evidence("space", "감각적인 실내 공간"),
    ] }, need).text).toBe("감각적인 실내 공간");
  });

  it("retains explicit selection provenance and session-only rejection events", () => {
    const options = initialExplorationPreferences("카페만 가고 싶어", state);
    expect(options.provenance.cafe).toBe("explicit_text");
    const detailed = initialExplorationPreferences("아울렛 쇼핑하고 미술관도 가고 싶어", state);
    expect(detailed.shoppingKinds).toEqual(["outlet"]);
    expect(detailed.cultureKinds).toEqual(["art_museum"]);
    expect(detailed.provenance.shoppingKind).toBe("explicit_text");
    expect(explorationPrompt("부산 1박2일", detailed)).toContain("쇼핑 종류: 아울렛");
    const session = emptySessionCandidates("new-planning-session");
    expect(session.records).toEqual([]);
  });
});
