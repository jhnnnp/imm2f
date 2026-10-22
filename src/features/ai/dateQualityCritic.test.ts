import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { assessDatePlanQuality, evaluateQualityEvidence } from "./dateQualityCritic";
import type { ExperiencePlan } from "./experiencePlan";
import type { CandidateExplorationPreferences } from "./candidateExploration";

const now = Date.parse("2026-10-20T13:00:00Z");
function venue(id: string, category: DiscoverCandidate["category"] = "cafe", text?: string): DiscoverCandidate {
  const candidate: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: id, name: "장소 " + id,
    category, categoryLabel: category === "restaurant" ? "식당" : category === "cafe" ? "카페" : "관광명소",
    district: "성동구", address: "서울 성동구 성수이로 1", roadAddress: "서울 성동구 성수이로 1",
    phone: "", mapUrl: "https://place.map.kakao.com/" + id, coordinates: [127.04, 37.56] };
  if (text) candidate.evidence = [{ id: "fact-" + id, text, sourceExcerpt: text,
    venueId: "kakao:" + id, branchName: candidate.name, sourceVenueName: candidate.name,
    sourceAddress: candidate.address, url: "https://example.com/" + id,
    checkedAt: new Date(now - 3600000).toISOString(), verification: "search_report", attribute: "space" }];
  return candidate;
}
const plan = (candidates: DiscoverCandidate[]) => ({ items: candidates.map(candidate => ({
  id: candidate.externalPlaceId, placeId: "discover:kakao:" + candidate.externalPlaceId })),
  recommendations: candidates.map(candidate => ({ id: "kakao:" + candidate.externalPlaceId })),
}) as AIPlannerReply;
const assess = (message: string, selected: DiscoverCandidate[], candidates = selected) =>
  assessDatePlanQuality({ message, state: emptyDateBrief(), reply: plan(selected), candidates, now });

describe("exact branch quality evidence", () => {
  it.each(["조용하지 않습니다.", "혼잡하고 음악 소음이 높습니다.", "사람들로 붐비는 공간입니다."])(
    "does not count contradicting noise/crowd facts as quiet: %s", text => {
      expect(evaluateQualityEvidence(venue("noisy", "cafe", text), "quiet", now).status).toBe("contradicted");
    });

  it.each(["조용한 좌석이 있습니다.", "소음이 적은 실내 공간입니다.", "한적한 정원 공간입니다.", "시끄럽지 않은 공간입니다."])(
    "credits the source's actual positive noise evidence: %s", text => {
      expect(evaluateQualityEvidence(venue("quiet", "cafe", text), "quiet", now).status).toBe("supported");
    });

  it.each(["대화하기 좋은 넓은 좌석입니다.", "시끄러운지 확인하지 못했습니다.", "조용한지는 아직 모르겠습니다.", "조용한지는 알 수 없습니다."])(
    "does not infer quietness from conversation suitability or an unknown: %s", text => {
      expect(evaluateQualityEvidence(venue("unknown", "cafe", text), "quiet", now).status).toBe("unknown");
    });

  it("does not transfer a branch's evidence or a venue name into quality", () => {
    const candidate = venue("identity");
    candidate.name = "조용한 전망 파스타 카페";
    candidate.detailedCategory = "음식점 > 양식 > 파스타";
    expect(evaluateQualityEvidence(candidate, "quiet", now).status).toBe("unknown");
    expect(evaluateQualityEvidence(candidate, "view", now).status).toBe("unknown");
    expect(evaluateQualityEvidence(candidate, "menu", now, "파스타").status).toBe("unknown");
    candidate.evidence = venue("other", "cafe", "조용하고 전망이 좋은 공간입니다.").evidence;
    expect(evaluateQualityEvidence(candidate, "quiet", now).status).toBe("unknown");
  });

  it("does not infer quietness from a venue name quoted inside a valid branch description", () => {
    const candidate = venue("name-only", "cafe", "조용한카페에는 넓은 정원과 테라스가 있습니다.");
    candidate.name = "조용한카페";
    candidate.evidence![0].branchName = candidate.name;
    candidate.evidence![0].sourceVenueName = candidate.name;
    expect(evaluateQualityEvidence(candidate, "quiet", now).status).toBe("unknown");
    expect(evaluateQualityEvidence(candidate, "aesthetic", now).status).toBe("supported");
  });

  it.each([
    { checkedAt: "2020-01-01T00:00:00Z" }, { checkedAt: "2027-01-01T00:00:00Z" },
    { venueId: undefined }, { url: "javascript:alert(1)" }, { url: "https://user:password@example.com/fact" },
    { sourceExcerpt: "" }, { branchName: "다른 지점" }, { sourceVenueName: "다른 지점" },
    { sourceAddress: "서울 성동구 성수이로 10" }, { sourceAddress: undefined }, { sourceVenueName: undefined },
  ])("rejects stale, future, unbound and invalid cited observations %j", patch => {
    const candidate = venue("reject", "cafe", "조용하고 한적한 공간입니다.");
    candidate.evidence = [{ ...candidate.evidence![0], ...patch }];
    expect(evaluateQualityEvidence(candidate, "quiet", now).status).toBe("unknown");
  });

  it("does not let a positive report override a contrary current exact-branch report", () => {
    const candidate = venue("conflict", "cafe", "조용한 정원 좌석입니다.");
    candidate.evidence!.push({ ...candidate.evidence![0], id: "contrary", text: "음악이 시끄럽습니다.",
      sourceExcerpt: "음악이 시끄럽습니다.", url: "https://example.com/conflict-2" });
    expect(evaluateQualityEvidence(candidate, "quiet", now).status).toBe("contradicted");
  });

  it("uses public dishes only with an exact provider citation or a current branch-bound source", () => {
    const candidate = { ...venue("menu", "restaurant"), dishes: "파스타와 뇨키",
      factSourceUrl: "https://example.com/unrelated" };
    expect(evaluateQualityEvidence(candidate, "menu", now, "파스타").status).toBe("unknown");
    candidate.factSourceUrl = candidate.mapUrl;
    expect(evaluateQualityEvidence(candidate, "menu", now, "파스타").status).toBe("supported");
    candidate.dishes = "파스타는 판매하지 않습니다.";
    expect(evaluateQualityEvidence(candidate, "menu", now, "파스타").status).toBe("contradicted");
  });

  it("requires the reported observation and excerpt to agree about the desired attribute", () => {
    const candidate = venue("excerpt", "cafe", "조용한 실내 공간입니다.");
    candidate.evidence![0].sourceExcerpt = "정원 좌석과 통창이 있습니다.";
    expect(evaluateQualityEvidence(candidate, "quiet", now).status).toBe("unknown");
  });

  it("keeps an explicitly negated good view contrary rather than rewarding its keyword", () => {
    expect(evaluateQualityEvidence(venue("blocked-view", "cafe", "전망이 좋지 않은 공간입니다."), "scenic", now).status)
      .toBe("contradicted");
  });
});

describe("request satisfaction independent of itinerary feasibility", () => {
  it("repairs explicit quiet and exact menu requests even with nonempty feasible stops", () => {
    const meal = venue("meal", "restaurant", "수제 면 요리를 제공합니다.");
    const cafe = venue("cafe", "cafe", "사람들이 붐비고 음악이 시끄럽습니다.");
    const result = assess("파스타 먹고 조용히 대화하고 싶어", [meal, cafe]);
    expect(result.needsRepair).toBe(true);
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "menu", value: "파스타", status: "unknown", origin: "explicit_constraint" }),
      expect.objectContaining({ dimension: "quiet", status: "contradicted", origin: "explicit_constraint" }),
    ]));
    expect(result.researchNeeds.some(need => need.evidenceNeeded.includes("noise"))).toBe(true);
    expect(result.researchNeeds.some(need => need.evidenceNeeded.includes("menu"))).toBe(true);
  });

  it("treats an unknown inferred taste as soft and does not trigger another search", () => {
    const cafe = venue("soft");
    const result = assessDatePlanQuality({ state: { ...emptyDateBrief(), preferences: { vibe: ["조용한"], crowdTolerance: 0.2 } },
      reply: plan([cafe]), candidates: [cafe], now });
    expect(result.requirements[0]).toMatchObject({ dimension: "quiet", origin: "inferred_preference", status: "unknown" });
    expect(result.needsRepair).toBe(false);
    expect(result.researchNeeds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps scenery category-bound instead of crediting a lookout for a cafe's view", () => {
    const cafe = venue("plain-cafe");
    const lookout = venue("lookout", "tourist", "전망대에서 바다 풍경을 볼 수 있습니다.");
    const result = assess("전망 좋은 카페에 가고 싶어", [cafe, lookout]);
    expect(result.requirements).toContainEqual(expect.objectContaining({ category: "cafe", dimension: "scenic", status: "unknown" }));
    expect(result.needsRepair).toBe(true);
  });

  it("offers a sourced alternative already in the observed pool", () => {
    const cafe = venue("selected");
    const quiet = venue("alternative", "cafe", "조용하고 한적한 좌석입니다.");
    const result = assess("조용한 카페 가고 싶어", [cafe], [cafe, quiet]);
    expect(result.requirements[0].alternativeCandidateIds).toEqual(["kakao:alternative"]);
    expect(result.requirements[0].candidateIds).toEqual(["kakao:selected"]);
  });

  it("respects a later rejected quality and menu while retaining unrelated wishes", () => {
    const cafe = venue("correction");
    const result = assessDatePlanQuality({ state: { ...emptyDateBrief(),
      userRequests: ["조용한 한옥 카페와 파스타", "조용한 곳 말고 활기찬 곳. 파스타 말고"] },
      reply: plan([cafe]), candidates: [cafe], now });
    expect(result.requirements.some(item => item.dimension === "quiet" || item.dimension === "menu")).toBe(false);
    expect(result.requirements.some(item => item.dimension === "hanok")).toBe(true);
  });

  it("does not turn food exclusions into positive menu requirements", () => {
    const result = assess("해산물은 못 먹고 파스타는 제외해줘. 조용한 카페로", [venue("food-exclusion")]);
    expect(result.requirements.some(item => item.dimension === "menu")).toBe(false);
    expect(result.requirements.some(item => item.dimension === "quiet")).toBe(true);
  });

  it("does not certify all requested quiet venues because only one selected branch is quiet", () => {
    const quiet = venue("one-quiet", "cafe", "조용하고 한적한 좌석입니다.");
    const noisy = venue("one-noisy", "cafe", "혼잡하고 시끄러운 공간입니다.");
    const result = assess("조용한 곳만 모두 골라줘", [quiet, noisy]);
    expect(result.requirements[0].status).toBe("contradicted");
    expect(result.needsRepair).toBe(true);
  });

  it("uses explicit structured experience provenance without promoting approved semantic wishes", () => {
    const cafe = venue("structured");
    const experiencePlan = { qualitativeNeeds: [
      { category: "cafe", dimension: "hanok", source: "explicit_user" },
      { category: "any", dimension: "quiet", source: "approved_semantic" },
    ] } as ExperiencePlan;
    const result = assessDatePlanQuality({ state: emptyDateBrief(), experiencePlan, reply: plan([cafe]), candidates: [cafe], now });
    expect(result.requirements).toContainEqual(expect.objectContaining({ dimension: "hanok", origin: "explicit_constraint" }));
    expect(result.requirements).toContainEqual(expect.objectContaining({ dimension: "quiet", origin: "inferred_preference" }));
    expect(result.researchNeeds).toHaveLength(1);
  });

  it("distinguishes user-selected cafe qualities from inferred exploration defaults", () => {
    const cafe = venue("intake-view");
    const preferences: CandidateExplorationPreferences = { activities: ["cafe"], cafeQualities: ["view"],
      cuisines: [], shoppingKinds: [], cultureKinds: [], additionalDetails: "", pace: "balanced",
      provenance: { "cafe:view": "user_selected" } };
    const explicit = assessDatePlanQuality({ state: emptyDateBrief(), explorationPreferences: preferences,
      reply: plan([cafe]), candidates: [cafe], now });
    expect(explicit.needsRepair).toBe(true);
    expect(explicit.requirements[0]).toMatchObject({ category: "cafe", dimension: "view", origin: "explicit_constraint" });
    const inferred = assessDatePlanQuality({ state: emptyDateBrief(), explorationPreferences: {
      ...preferences, provenance: { "cafe:view": "inferred" } }, reply: plan([cafe]), candidates: [cafe], now });
    expect(inferred.needsRepair).toBe(false);
  });

  it("credits positive provider-bound exact menu evidence and quiet evidence from the selected stops", () => {
    const meal = venue("pasta", "restaurant", "메뉴에 파스타와 뇨키가 있습니다.");
    const cafe = venue("talk", "cafe", "조용한 정원 좌석입니다.");
    const result = assess("파스타 먹고 조용히 대화하고 싶어", [meal, cafe]);
    expect(result.needsRepair).toBe(false);
    expect(result.requirements.every(item => item.status === "supported")).toBe(true);
    expect(result.requirements.every(item => item.sourceUrls.length > 0)).toBe(true);
  });

  it("satisfies different requested dishes at their own meal stops across a trip", () => {
    const pasta = venue("trip-pasta", "restaurant", "점심 메뉴에는 파스타와 뇨키가 있습니다.");
    const sushi = venue("trip-sushi", "restaurant", "저녁 메뉴에는 초밥과 우동이 있습니다.");
    const result = assessDatePlanQuality({ state: { ...emptyDateBrief(), stayKind: "overnight", nights: 1 },
      message: "1박2일 여행에서 파스타 먹고 저녁에는 초밥 먹을래", reply: plan([pasta, sushi]), candidates: [pasta, sushi], now });
    const menus = result.requirements.filter(item => item.dimension === "menu");
    expect(menus).toHaveLength(2);
    expect(menus.every(item => item.status === "supported")).toBe(true);
    expect(menus.find(item => item.value === "파스타")?.supportingCandidateIds).toEqual(["kakao:trip-pasta"]);
    expect(menus.find(item => item.value === "초밥")?.supportingCandidateIds).toEqual(["kakao:trip-sushi"]);
    expect(result.needsRepair).toBe(false);
    expect(result.researchNeeds).toEqual([]);
  });
});
