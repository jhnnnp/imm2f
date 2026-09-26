import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { buildDateCandidatePool } from "@/features/ai/dateCandidatePool";
import { evaluateCourse } from "@/features/ai/courseDesign";
import { verifyDateItinerary } from "@/features/ai/dateVerifier";
import { completeJson } from "./client";
import { courseProposalMessages, recommendDatePlanWithOpenAi } from "./recommendDatePlan";
import type { SemanticPlanningHints } from "@/features/ai/semanticPlanningHints";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
vi.mock("./datePlaybook", () => ({ retrieveDatePlaybook: vi.fn(async () => []) }));
vi.mock("./enrichDateVenues", () => ({ enrichDateVenues: vi.fn(async (pool: DiscoverCandidate[]) => pool) }));
vi.mock("@/lib/routing/footRoute", () => ({ fetchFootRoute: vi.fn(async (points: unknown[]) => ({
  provider: "osm_foot", meters: (points.length - 1) * 200, seconds: (points.length - 1) * 180,
  legs: Array.from({ length: points.length - 1 }, () => ({ meters: 200, seconds: 180 })),
})) }));

function venue(id: string, name: string, category: DiscoverCandidate["category"], longitude: number,
  evidenceText?: string): DiscoverCandidate {
  return {
    externalSource: "kakao", externalPlaceId: id, name, category,
    categoryLabel: category === "cafe" ? "카페" : category === "restaurant" ? "식당" : "관광지",
    district: "성동구", address: "성수", roadAddress: "성수", phone: "", mapUrl: "",
    coordinates: [longitude, 37.56],
    ...(evidenceText ? { evidence: [{ id: `fact-${id}`, venueId: `kakao:${id}`,
      text: evidenceText, url: `https://example.com/${id}`, checkedAt: "2026-09-26",
      attribute: "space" as const, verification: "search_report" as const }] } : {}),
  };
}
const candidates = [
  venue("meal", "정원 식당", "restaurant", 127.0400),
  venue("quiet", "정원 카페", "cafe", 127.0408, "이 지점은 조용한 실내 좌석과 정원이 있습니다."),
  venue("noisy", "활기 카페", "cafe", 127.0410, "이 지점은 사람들로 붐비고 음악 소리가 큰 공간입니다."),
  venue("walk", "작은 공원", "tourist", 127.0415),
];
const state = () => ({ ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"] });
const condition = { region: "성수", dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00",
  budget: null, timeSpecified: false };
const modelCourse = { courses: [{ theme: "성수에서 산책과 쉼", selected: ["meal", "quiet", "walk"]
  .map(id => ({ id: `kakao:${id}`, day_index: 0, duration_minutes: 60 })) }] };

beforeEach(() => vi.mocked(completeJson).mockReset().mockResolvedValue(modelCourse));
afterEach(() => vi.restoreAllMocks());

describe("course proposal semantic boundary", () => {
  it("keeps the old message contract exactly when hints are absent", () => {
    const payload = { candidates: [{ id: "kakao:quiet" }], budgetWon: 100000 };
    const messages = courseProposalMessages(payload);
    expect(JSON.parse(messages[1].content)).toEqual(payload);
    expect(messages[0].content).not.toContain("semanticPlanningHints");
    expect(courseProposalMessages(payload, {})).toEqual(messages);
  });

  it("keeps a no-signal ASSIST proposal equivalent on the same fixed pool", async () => {
    const input = { prompt: "성수 데이트 코스", condition, candidates, saved: [], state: state() };
    const off = await recommendDatePlanWithOpenAi(input);
    const offMessages = vi.mocked(completeJson).mock.lastCall?.[0].messages;
    const assist = await recommendDatePlanWithOpenAi({ ...input, semanticPlanningHints: {} });
    const assistMessages = vi.mocked(completeJson).mock.lastCall?.[0].messages;
    expect(assistMessages).toEqual(offMessages);
    expect(assist.recommendations.map(item => item.id)).toEqual(off.recommendations.map(item => item.id));
    expect(assist.items.map(item => item.placeName)).toEqual(off.items.map(item => item.placeName));
    expect(assist.design?.degraded).toBe(off.design?.degraded);
  });

  it("sends hints as soft course wishes alongside real evidence, never as candidate properties", () => {
    const payload = { candidates: candidates.map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`,
      observations: candidate.evidence ?? [] })), keepPlaces: ["정원 식당"], budgetWon: 100000 };
    const messages = courseProposalMessages(payload, { pace: "relaxed", novelty: "high", noisePreference: "quiet" });
    const sent = JSON.parse(messages[1].content);
    expect(sent.semanticPlanningHints).toEqual({ pace: "relaxed", novelty: "high", noisePreference: "quiet" });
    expect(sent.candidates[1].observations[0].text).toContain("조용한");
    expect(sent.candidates[2].observations[0].text).toContain("붐비고");
    expect(sent.candidates[3].observations).toEqual([]);
    expect(sent.candidates.map((candidate: { id: string }) => candidate.id))
      .toEqual(candidates.map(candidate => `kakao:${candidate.externalPlaceId}`));
    expect(messages[0].content).toContain("missing observation is unknown and neutral");
    expect(messages[0].content).toContain("never drop a required place");
    expect(messages[0].content).toContain("avoid unnecessary stops");
  });

  it("leaves hard candidate eligibility and required-place verification unchanged", () => {
    const constrained = { ...state(), budgetWon: 100000, excludedFoods: ["해산물"],
      requiredPlaces: ["정원 식당"] };
    const seafood = { ...venue("seafood", "해산물 카페", "cafe", 127.0411), dishes: "해산물 요리" };
    const costly = { ...venue("costly", "고가 식당", "restaurant", 127.0412), expectedCostTwo: 200000 };
    const pool = buildDateCandidatePool([...candidates, seafood, costly], constrained);
    expect(pool.eligible.map(item => item.externalPlaceId)).not.toContain("seafood");
    expect(pool.eligible.map(item => item.externalPlaceId)).not.toContain("costly");
    expect(pool.records.find(item => item.id === "kakao:seafood")?.rejectedReasons).toContain("excluded_food");
    expect(pool.records.find(item => item.id === "kakao:costly")?.rejectedReasons).toContain("over_budget");
    const omittedRequired = evaluateCourse({ theme: "novel", rows: [{ id: "kakao:quiet", day_index: 0 },
      { id: "kakao:walk", day_index: 0 }] }, pool.eligible, constrained, new Set());
    expect(verifyDateItinerary({ course: omittedRequired, candidates: pool.eligible, state: constrained,
      condition, route: null }).issues).toEqual(expect.arrayContaining(["유지할 장소 누락: 정원 식당"]));
  });

  it("compares fixed-pool course behavior for no hint, pace, activity, and quiet novelty requests", async () => {
    const scenarios: Array<{ message: string; hints?: SemanticPlanningHints }> = [
      { message: "성수 데이트 코스" },
      { message: "성수에서 여유롭게 데이트", hints: { pace: "relaxed" } },
      { message: "성수에서 활동적인 데이트", hints: { activityLevel: "high" } },
      { message: "성수에서 조용하고 안 뻔한 데이트", hints: { noisePreference: "quiet", novelty: "high" } },
    ];
    const results = [];
    for (const scenario of scenarios) {
      const result = await recommendDatePlanWithOpenAi({ prompt: scenario.message, condition,
        candidates, saved: [], state: state(), semanticPlanningHints: scenario.hints });
      const call = vi.mocked(completeJson).mock.lastCall?.[0];
      const sent = JSON.parse(call?.messages[1].content ?? "{}");
      expect(sent.candidates.map((candidate: { id: string }) => candidate.id).sort())
        .toEqual(candidates.map(candidate => `kakao:${candidate.externalPlaceId}`).sort());
      expect(sent.semanticPlanningHints).toEqual(scenario.hints);
      const selected = evaluateCourse({ theme: "", rows: result.recommendations.map(item => ({
        id: item.id, day_index: 0,
      })) }, candidates, state(), new Set());
      const verification = verifyDateItinerary({ course: selected, candidates, state: state(), condition, route: null });
      results.push({ ids: result.recommendations.map(item => item.id), count: result.items.length,
        order: result.items.map(item => item.placeName),
        score: Object.fromEntries(Object.entries(result.design?.scoreBreakdown ?? {})
          .map(([key, value]) => [key, Math.round(value * 10_000) / 10_000])),
        verification });
    }
    // The mocked model returns one fixed proposal. Hints alone do not alter hard filtering,
    // deterministic scoring, or verification; model quality is a separate evaluation.
    expect(results[0].count).toBeGreaterThanOrEqual(2);
    expect(results[0].verification.passed).toBe(true);
    expect(results.slice(1)).toEqual([results[0], results[0], results[0]]);
    expect(vi.mocked(completeJson)).toHaveBeenCalledTimes(scenarios.length);
  });

  it("keeps fallback and final verification when the model fails or violates hard constraints", async () => {
    vi.mocked(completeJson).mockResolvedValue(null);
    const fallback = await recommendDatePlanWithOpenAi({ prompt: "성수에서 여유롭게", condition,
      candidates, saved: [], state: state(), semanticPlanningHints: { pace: "relaxed" } });
    expect(fallback.items.length).toBeGreaterThanOrEqual(2);
    const constrained = { ...state(), budgetWon: 100000, requiredPlaces: ["정원 식당"], excludedFoods: ["해산물"] };
    const expensiveSeafood = { ...candidates[0], name: "해산물 식당", expectedCostTwo: 200000,
      dishes: "해산물 파스타" };
    const invalid = evaluateCourse({ theme: "", rows: [{ id: "kakao:meal", day_index: 0 },
      { id: "kakao:quiet", day_index: 0 }] }, [expensiveSeafood, ...candidates.slice(1)], constrained, new Set());
    const verification = verifyDateItinerary({ course: invalid,
      candidates: [expensiveSeafood, ...candidates.slice(1)], state: constrained, condition, route: null });
    expect(verification.passed).toBe(false);
    expect(verification.issues).toEqual(expect.arrayContaining(["확인된 비용이 예산 초과", "제외 음식이 포함된 장소"]));
  });
});
