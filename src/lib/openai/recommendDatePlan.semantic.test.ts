import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { buildDateCandidatePool } from "@/features/ai/dateCandidatePool";
import { evaluateCourse } from "@/features/ai/courseDesign";
import { verifyDateItinerary } from "@/features/ai/dateVerifier";
import { completeJson } from "./client";
import { courseProposalMessages, footRouteForDays, recommendDatePlanWithOpenAi } from "./recommendDatePlan";
import { enrichDateVenues } from "./enrichDateVenues";
import { retrieveDatePlaybook } from "./datePlaybook";
import { fetchFootRoute } from "@/lib/routing/footRoute";
import type { SemanticPlanningHints } from "@/features/ai/semanticPlanningHints";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
vi.mock("./datePlaybook", async importOriginal => ({ ...await importOriginal<typeof import("./datePlaybook")>(),
  retrieveDatePlaybook: vi.fn(async () => []) }));
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
  it("requests one complete curated itinerary and uses bundled guidance without a semantic retrieval round trip", async () => {
    vi.mocked(retrieveDatePlaybook).mockClear();
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true });
    const request = vi.mocked(completeJson).mock.calls[0][0];
    const payload = JSON.parse(request.messages[1].content);
    expect(payload.proposalCount).toBe(1);
    expect(request.jsonSchema).toMatchObject({ schema: { properties: { courses: { maxItems: 1 } } } });
    expect(payload.planningPlaybook.map((card: { id: string }) => card.id)).toContain("venue-specific-evidence");
    expect(retrieveDatePlaybook).not.toHaveBeenCalled();
    expect(request.maxTokens).toBeLessThan(2400);
    expect(result.recommendations.map(item => item.id)).toEqual(["kakao:meal", "kakao:quiet", "kakao:walk"]);
  });

  it("does not wait for fallback walking routes when the model itinerary already passes verification", async () => {
    vi.mocked(fetchFootRoute).mockClear();
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true });
    expect(result.source).toBe("openai");
    expect(result.design?.routeBasis).toBe("walking");
    expect(fetchFootRoute).toHaveBeenCalledTimes(1);
  });

  it("still verifies fallback routes when the preferred model route fails", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ ...modelCourse.courses[0],
      selected: modelCourse.courses[0].selected.map(row => ({ ...row,
        id: row.id === "kakao:quiet" ? "kakao:noisy" : row.id })) }] });
    vi.mocked(fetchFootRoute).mockClear().mockResolvedValueOnce({ provider: "osm_foot", meters: 1000,
      seconds: 86400, legs: [{ meters: 500, seconds: 43200 }, { meters: 500, seconds: 43200 }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true });
    expect(vi.mocked(fetchFootRoute).mock.calls.length).toBeGreaterThan(1);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.design?.routeBasis).toBe("walking");
    expect(result.source).toBe("fallback");
  });

  it("preserves the model's grounded selection judgment, intro and cited source through validation and scheduling", async () => {
    const intro = "걷는 시간 사이에 앉아서 대화할 여유를 두고, 식사와 휴식을 자연스럽게 이어봤어요. 영업시간과 예약 여부는 방문 전에 확인해 주세요.";
    const reason = "자료에 소개된 정원 좌석을 참고해, 둘이 쉬어가는 경험을 이곳에 담았어요.";
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ ...modelCourse.courses[0], intro,
      selected: modelCourse.courses[0].selected.map(row => ({ ...row, reason: row.id === "kakao:quiet" ? reason
        : "식사와 바깥 활동을 번갈아 경험할 수 있게 이 장소를 골랐어요.",
        evidenceIds: row.id === "kakao:quiet" ? ["observation:fact-quiet"] : ["provider:category"] })) }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수에서 대화하면서 여유 있게 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true });
    expect(result.source).toBe("openai");
    expect(result.card.lines[0]).toBe(intro);
    expect(result.recommendations.find(place => place.id === "kakao:quiet")?.reasons).toEqual([reason]);
    expect(result.items.find(item => item.placeName === "정원 카페")?.memo).toBe(reason);
    expect(result.card.stops?.find(stop => stop.name === "정원 카페")?.factSourceUrl).toBe("https://example.com/quiet");
    expect(vi.mocked(completeJson).mock.calls[0][0].reasoningEffort).toBe("low");
  });

  it("discards unsupported generated venue claims while preserving the valid itinerary", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ ...modelCourse.courses[0],
      selected: modelCourse.courses[0].selected.map(row => ({ ...row,
        reason: "예약 없이 바로 들어가고 평점 4.9점인 조용한 맛집이에요.", evidenceIds: ["provider:category"] })) }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true });
    expect(result.source).toBe("openai");
    expect(result.recommendations).toHaveLength(3);
    expect(result.recommendations.map(place => place.reasons.join(" ")).join(" ")).not.toMatch(/예약\s*없이|4\.9점/);
  });

  it("supports a single chosen cafe rather than requiring a filler second stop", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ theme: "카페에서 쉬기", selected: [
      { id: "kakao:quiet", day_index: 0, duration_minutes: 60 },
    ] }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "이 카페 한 곳에서 쉬고 싶어", condition,
      candidates: [candidates[1]], saved: [], state: state(), anchorCandidateIds: ["kakao:quiet"], researchPlanActive: true });
    expect(result.source).toBe("openai");
    expect(result.items.map(item => item.placeName)).toEqual(["정원 카페"]);
  });
  it("omits historic budgets from planning and keeps price-independent eligibility", async () => {
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates: candidates.map(candidate => ({ ...candidate, expectedCostTwo: 100000 })),
      saved: [], state: { ...state(), budgetWon: 0 }, researchPlanActive: true });
    expect(result.items.length).toBeGreaterThan(0);
    const payload = JSON.parse(vi.mocked(completeJson).mock.calls[0][0].messages[1].content);
    expect(payload).not.toHaveProperty("budgetWon");
    expect(payload.dateIntent.hardConstraints).not.toHaveProperty("budgetWon");
    expect(payload.candidates.every((candidate: Record<string, unknown>) => !Object.hasOwn(candidate, "knownCostTwo"))).toBe(true);
    expect(vi.mocked(completeJson).mock.calls[0][0].messages[0].content).toContain("does not manage budgets");
    expect(result.message).not.toContain("예산");
  });

  it("explains provably impossible selections before research or model calls", async () => {
    vi.mocked(enrichDateVenues).mockClear();
    const result = await recommendDatePlanWithOpenAi({ prompt: "한 시간에 모두 방문", condition,
      candidates: candidates.slice(0, 3), saved: [], anchorCandidateIds: ["kakao:meal", "kakao:quiet", "kakao:noisy"],
      state: { ...state(), startTime: "15:00", endTime: "16:00" } });
    expect(result.items).toEqual([]);
    expect(result.design?.feasibility?.reason).toBe("selected_stays_exceed_time");
    expect(result.message).toContain("90분");
    expect(completeJson).not.toHaveBeenCalled();
    expect(enrichDateVenues).not.toHaveBeenCalled();
  });

  it("finishes stalled research at the shared deadline without launching a late model request", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.mocked(enrichDateVenues).mockClear().mockImplementationOnce(async () => {
      deadline.abort();
      return new Promise<DiscoverCandidate[]>(() => {});
    });
    const result = await recommendDatePlanWithOpenAi({ prompt: "이 카페에서 쉬기", condition,
      candidates: [candidates[1]], saved: [], state: state(), anchorCandidateIds: ["kakao:quiet"] });
    expect(vi.mocked(enrichDateVenues).mock.calls[0][4]).toBe(deadline.signal);
    expect(completeJson).not.toHaveBeenCalled();
    expect(result.source).toBe("fallback");
    expect(result.items.map(item => item.placeName)).toEqual(["정원 카페"]);
  });

  it("retains known two-person costs in generated and saved itinerary items", async () => {
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates: candidates.map(venue => ({ ...venue, ...(venue.externalPlaceId === "meal" ? { expectedCostTwo: 24000 } : {}) })),
      saved: [], state: state(), researchPlanActive: true });
    expect(result.items.find(item => item.placeName === "정원 식당")?.expectedCost).toBe(24000);
    expect(result.recommendations.find(item => item.name === "정원 식당")?.expectedCost).toBe(24000);
  });

  it("preserves every walking leg for thirteen stops using overlapping provider requests", async () => {
    vi.mocked(fetchFootRoute).mockClear();
    const pool = Array.from({ length: 13 }, (_, index) => venue(String(index), `장소 ${index}`, "nature", 127.04 + index * 0.0001));
    const rows = pool.map(venue => ({ id: `kakao:${venue.externalPlaceId}`, day_index: 0 }));
    const route = await footRouteForDays(rows, new Map(pool.map(venue => [`kakao:${venue.externalPlaceId}`, venue])), 1, 5000);
    expect(vi.mocked(fetchFootRoute).mock.calls.map(call => call[0].length)).toEqual([7, 7]);
    expect(vi.mocked(fetchFootRoute).mock.calls[0][0].at(-1)).toEqual(vi.mocked(fetchFootRoute).mock.calls[1][0][0]);
    expect(route).toMatchObject({ meters: 2400, seconds: 2160 });
    expect(route?.legs).toHaveLength(12);
  });

  it("shares one repair across malformed structure and subsequent actual-route rejection", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [] }).mockResolvedValueOnce(modelCourse);
    vi.mocked(fetchFootRoute).mockImplementation(async points => ({ provider: "osm_foot", meters: 1000,
      seconds: 86400, legs: Array.from({ length: points.length - 1 }, () => ({ meters: 500, seconds: 43200 })) }));
    try {
      const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
        candidates, saved: [], state: state(), researchPlanActive: true });
      expect(result.items).toEqual([]);
      expect(completeJson).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(completeJson).mock.calls;
      expect(calls[0][0].signal).toBe(calls[1][0].signal);
      expect(calls.every(call => call[0].retryOnTruncation === false)).toBe(true);
    } finally {
      vi.mocked(fetchFootRoute).mockImplementation(async points => ({ provider: "osm_foot",
        meters: (points.length - 1) * 200, seconds: (points.length - 1) * 180,
        legs: Array.from({ length: points.length - 1 }, () => ({ meters: 200, seconds: 180 })) }));
    }
  });

  it("sends fresh research, schedule windows and provider-bound schema to curation", async () => {
    vi.mocked(enrichDateVenues).mockResolvedValueOnce(candidates.map(candidate => ({ ...candidate,
      evidence: [{ id: "fresh", text: "정원과 야외 테라스가 있습니다.", url: "https://example.com/new", checkedAt: "2026-10-11" }] })));
    await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition, candidates, saved: [], state: state() });
    const call = vi.mocked(completeJson).mock.calls[0][0];
    const payload = JSON.parse(call.messages[1].content);
    expect(payload.candidates.every((candidate: { observations: Array<{ id: string }> }) => candidate.observations[0].id === "fresh")).toBe(true);
    expect(payload.schedule).toMatchObject({ transport: "walk", localDayWindows: {} });
    expect(call.jsonSchema).toMatchObject({ name: "date_course_proposals_v3", strict: true });
    expect(JSON.stringify(call.jsonSchema)).toContain("kakao:quiet");
  });

  it("includes fifteen chosen venues in a three-day model itinerary without a day-count quota", async () => {
    const pool = Array.from({ length: 15 }, (_, index) => venue(String(index), `작은 공원 ${index}`, "nature", 127.04 + index * 0.0001));
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ theme: "선택 장소를 모두 잇는 여행", selected: pool.map((candidate, index) => ({
      id: `kakao:${candidate.externalPlaceId}`, day_index: Math.floor(index / 5), duration_minutes: 30,
    })) }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "부산 2박3일", condition: { ...condition, region: "부산" },
      candidates: pool, anchorCandidateIds: pool.map(candidate => `kakao:${candidate.externalPlaceId}`), saved: [],
      state: { ...state(), stayKind: "overnight", nights: 2 }, researchPlanActive: true });
    expect(result.source).toBe("openai");
    expect(result.items).toHaveLength(15);
    expect(new Set(result.recommendations.map(place => place.id))).toEqual(new Set(pool.map(candidate => `kakao:${candidate.externalPlaceId}`)));
    const call = vi.mocked(completeJson).mock.calls[0][0];
    const payload = JSON.parse(call.messages[1].content);
    expect(payload).toMatchObject({ proposalCount: 1, requiredDayIndices: [0, 1, 2] });
    expect(call.reasoningEffort).toBe("medium");
    expect(call.jsonSchema?.schema.properties).toMatchObject({ courses: { maxItems: 1,
      items: { properties: { selected: { minItems: 15 } } } } });
  });

  it("schedules a requested night view after 18:00 while keeping every chosen venue", async () => {
    const pool = [venue("meal", "식당", "restaurant", 127.04), venue("cafe", "카페", "cafe", 127.041),
      { ...venue("view", "전망대", "tourist", 127.042), detailedCategory: "여행 > 전망대" }];
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ theme: "식사와 야경", selected: pool.map(candidate => ({
      id: `kakao:${candidate.externalPlaceId}`, day_index: 0, duration_minutes: 60,
    })) }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "야경", condition: { ...condition, startTime: "10:00", endTime: "22:00" },
      candidates: pool, anchorCandidateIds: pool.map(candidate => `kakao:${candidate.externalPlaceId}`), saved: [], researchPlanActive: true,
      state: { ...state(), startTime: "10:00", endTime: "22:00", activities: ["nightview"], discovery: {
        themes: [], priorities: [], queries: [], transport: "drive", requiredActivities: ["nightview"],
        activityOrder: [], minStops: 2, maxStops: 3,
      } } });
    expect(result.source).toBe("openai");
    expect(result.items).toHaveLength(3);
    expect(result.items.find(item => item.placeName === "전망대")?.startTime).toBe("18:00");
  });

  it("recovers complementary three-day sections as one complete chosen model itinerary", async () => {
    const pool = Array.from({ length: 10 }, (_, index) => venue(String(index), `공원 ${index}`, "nature", 127.04 + index * 0.0001));
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [0, 1, 2].map(day => ({ theme: `${day + 1}일차`,
      selected: pool.filter((_, index) => Math.min(2, Math.floor(index / 4)) === day).map(candidate => ({
        id: `kakao:${candidate.externalPlaceId}`, day_index: day, duration_minutes: 60,
      })) })) });
    const result = await recommendDatePlanWithOpenAi({ prompt: "부산 2박3일", condition, candidates: pool, saved: [], researchPlanActive: true,
      anchorCandidateIds: pool.map(candidate => `kakao:${candidate.externalPlaceId}`),
      state: { ...state(), nights: 2, stayKind: "overnight" } });
    expect(result.source).toBe("openai");
    expect(result.items).toHaveLength(10);
    expect(new Set(result.items.map(item => item.dayIndex))).toEqual(new Set([0, 1, 2]));
    expect(completeJson).toHaveBeenCalledTimes(1);
  });

  it("fits verified walking time instead of discarding a feasible timed model course", async () => {
    vi.mocked(fetchFootRoute).mockResolvedValueOnce({ provider: "osm_foot", meters: 800, seconds: 1200,
      legs: [{ meters: 800, seconds: 1200 }] });
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ theme: "식사와 카페", selected: ["meal", "quiet"]
      .map(id => ({ id: `kakao:${id}`, day_index: 0, duration_minutes: 60 })) }] });
    const result = await recommendDatePlanWithOpenAi({ prompt: "17시부터 20시 데이트", condition: { ...condition, startTime: "17:00", endTime: "20:00", timeSpecified: true },
      candidates: candidates.slice(0, 2), saved: [], researchPlanActive: true,
      state: { ...state(), startTime: "17:00", endTime: "20:00" } });
    expect(result.source).toBe("openai");
    expect(result.items.map(item => item.startTime)).toEqual(["17:00", "18:20"]);
    expect(result.design?.degraded).toBe(false);
  });

  it("keeps explicit transit time instead of replacing it with walking legs or limits", async () => {
    vi.mocked(fetchFootRoute).mockClear();
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수에서 대중교통으로 데이트", condition,
      candidates, saved: [], researchPlanActive: true, state: { ...state(), discovery: {
        themes: [], priorities: [], queries: [], transport: "transit", requiredActivities: [],
        activityOrder: [], minStops: 2, maxStops: 4,
      } } });
    expect(result.source).toBe("openai");
    expect(result.items).toHaveLength(3);
    expect(fetchFootRoute).not.toHaveBeenCalled();
    expect(vi.mocked(completeJson)).toHaveBeenCalledTimes(1);
  });

  it("repairs a non-null malformed model structure before falling back", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ courses: [{ selected: [{ id: "kakao:meal", day_index: 99, duration_minutes: 60 }] }] })
      .mockResolvedValueOnce(modelCourse);
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition, candidates, saved: [], state: state(), researchPlanActive: true });
    expect(result.source).toBe("openai");
    expect(vi.mocked(completeJson)).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(completeJson).mock.calls[1][0].messages[1].content).structureProblems).toContain("모델이 유효한 코스 구조를 반환하지 않음");
  });

  it("uses already researched P3 candidates without launching legacy role research", async () => {
    vi.mocked(enrichDateVenues).mockClear();
    await recommendDatePlanWithOpenAi({ prompt: "성수 카페 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true });
    expect(enrichDateVenues).not.toHaveBeenCalled();
  });
  it("passes intake preferences to the model and accepts its feasible course before seeds", async () => {
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 카페 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true,
      explorationPreferences: { activities: ["cafe"], cafeQualities: ["view"], cuisines: [],
        shoppingKinds: [], cultureKinds: [], additionalDetails: "전망 좋은 곳", pace: "relaxed",
        provenance: { pace: "user_selected" } } });
    const sent = JSON.parse(vi.mocked(completeJson).mock.calls[0][0].messages[1].content);
    expect(sent.explorationPreferences).toMatchObject({ interests: ["cafe"], pace: "relaxed" });
    expect(sent.feasibleAlternatives).toBeUndefined();
    expect(result.source).toBe("openai");
    expect(result.recommendations.map(item => item.id)).toEqual(["kakao:meal", "kakao:quiet", "kakao:walk"]);
  });
  it("keeps a selected provider ID even when the model omits it", async () => {
    const result = await recommendDatePlanWithOpenAi({ prompt: "성수 데이트", condition,
      candidates, saved: [], state: state(), researchPlanActive: true,
      anchorCandidateIds: ["kakao:noisy"] });
    expect(result.recommendations.map(item => item.id)).toContain("kakao:noisy");
    const sent = JSON.parse(vi.mocked(completeJson).mock.calls[0][0].messages[1].content);
    expect(sent.selectedAnchorIds).toEqual(["kakao:noisy"]);
  });
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
    expect(pool.eligible.map(item => item.externalPlaceId)).toContain("costly");
    expect(pool.records.find(item => item.id === "kakao:seafood")?.rejectedReasons).toContain("excluded_food");
    expect(pool.records.find(item => item.id === "kakao:costly")?.rejectedReasons).toEqual([]);
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
        verification: { ...verification, qualitySignals: verification.qualitySignals.map(signal => ({
          ...signal, value: Math.round(signal.value * 10_000) / 10_000,
        })) } });
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
    expect(verification.issues).toEqual(expect.arrayContaining(["제외 음식이 포함된 장소"]));
    expect(verification.issues).not.toContain("확인된 비용이 예산 초과");
  });
});
