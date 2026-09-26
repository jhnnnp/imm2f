import { describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerResult } from "@/features/planning/types/plan";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import type { DateExecutionPlan, DateExecutionTask } from "./dateExecutionPlan";
import { appendPlaceRecommendation, currentSessionVenue, executeLimitedPlaceRecommendation,
  legacyPlacesReuseEnabled, reusablePlaceCandidates, sessionPlaceRecommendationInputs,
  type PlaceRecommendationCapability } from "./datePlaceRecommendationExecution";
import { mergeSessionCandidates, type SessionCandidateContext } from "./sessionCandidates";

const now = "2026-09-26T10:00:00Z";
const state = withAreas(emptyDateBrief(), ["성수"]);
const venue = (id: string, changes: Partial<DiscoverCandidate> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name: `${id} 카페`, category: "cafe",
  categoryLabel: "카페", kakaoCategoryGroupCode: "CE7", district: "성수", address: `서울 성수 ${id}`,
  roadAddress: `서울 성수 ${id}`, phone: "", mapUrl: "", coordinates: [127.04, 37.56],
  searchRegion: "성수", ...changes,
});
const session = (places: DiscoverCandidate[], shown: string[] = [], recordState = state,
  observedAt = now): SessionCandidateContext => mergeSessionCandidates(null,
  buildDateCandidatePool(places, recordState).records,
  { sessionId: "s", turnId: "s:1", observedAt,
    shownPlaces: shown.map(name => ({ name })) });
const task: DateExecutionTask = { id: "recommend", type: "recommend_places", goal: "recommend_places",
  dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned", source: "llm" };
const plan: DateExecutionPlan = { tasks: [task], unresolved: [], executable: true,
  source: "effective_understanding" };
const primary: AIPlannerResult = { status: "chat", message: "기존 답변",
  card: { headline: "기존", lines: ["기존 답변"] }, state };
const recommend = vi.fn<PlaceRecommendationCapability>(async input => ({
  ...primary, card: { headline: "추천", lines: ["새로운 카페"],
    stops: input.reusable.map(item => ({ name: item.name, meta: "카페",
      address: item.roadAddress })) },
}));
const execute = (overrides: Partial<Parameters<typeof executeLimitedPlaceRecommendation>[0]> = {}) =>
  executeLimitedPlaceRecommendation({ plan, task, route: { mode: "course", confident: true },
    interpreterMode: "assist", executionMode: "limited", state, message: "다른 카페 보여줘",
    sessionCandidates: session([venue("a"), venue("b"), venue("c")]), now,
    recommend, ...overrides });

describe("limited place recommendation", () => {
  it("reuses unseen eligible candidates before searching and keeps the primary result contract", async () => {
    recommend.mockClear();
    const outcome = await execute();
    expect(outcome.result).toMatchObject({ status: "success", searched: false, reusedCount: 3 });
    expect(recommend).toHaveBeenCalledWith(expect.objectContaining({ search: false }));
    expect(appendPlaceRecommendation(primary, outcome.result)).toMatchObject({ status: "chat",
      card: { lines: ["기존 답변", "추가 장소 추천", "새로운 카페"] } });
  });

  it("does not turn supplementary places into stops of an existing course", async () => {
    const outcome = await execute();
    const course = { ...primary, status: "plan" as const,
      card: { ...primary.card, stops: [{ name: "기존 저녁", meta: "식당" }] },
      recommendations: [], items: [], candidateCount: 0, source: "fallback" as const,
      condition: { dateLabel: "2026-09-26", startTime: "15:00", endTime: "21:00",
        budget: null, region: "성수", timeSpecified: true } };
    const merged = appendPlaceRecommendation(course, outcome.result);
    expect(merged.card.stops?.map(stop => stop.name)).toEqual(["기존 저녁"]);
    expect(merged.card.lines.join(" ")).toContain("a 카페");
  });

  it("excludes shown candidates temporarily and searches only when unseen candidates are insufficient", async () => {
    recommend.mockClear();
    const outcome = await execute({ sessionCandidates: session([venue("a"), venue("b"), venue("c")], ["a 카페"]) });
    expect(outcome.result).toMatchObject({ searched: true, reusedCount: 2 });
    expect(recommend.mock.calls.at(-1)?.[0].excludedCandidateIds).toContain("kakao:a");
    expect(recommend.mock.calls.at(-1)?.[0].reusable.map(row => row.externalPlaceId)).toEqual(["b", "c"]);
  });

  it("lets a covered legacy places route reuse the same candidates only in assist limited mode", () => {
    const history = session([venue("a"), venue("b"), venue("c")]);
    const enabled = (interpreterMode: "off" | "shadow" | "assist", executionMode: "off" | "shadow" | "limited") =>
      legacyPlacesReuseEnabled({ session: history, interpreterMode, executionMode, plan });
    expect(enabled("off", "limited")).toBe(false);
    expect(enabled("shadow", "limited")).toBe(false);
    expect(enabled("assist", "shadow")).toBe(false);
    expect(enabled("assist", "limited")).toBe(true);
    const reuse = sessionPlaceRecommendationInputs({ session: history,
      ask: { kind: "cafe", query: "카페", area: "성수" }, state,
      message: "다른 카페 보여줘", now });
    expect(reuse).toMatchObject({ search: false, excludedCandidateIds: [] });
    expect(reuse.reusable.map(row => row.externalPlaceId)).toEqual(["a", "b", "c"]);
  });

  it("excludes a shown provider ID without discarding a different branch of the same name", () => {
    const first = venue("a", { name: "같은 카페", roadAddress: "성수 1", address: "성수 1" });
    const second = venue("b", { name: "같은 카페", roadAddress: "성수 2", address: "성수 2" });
    const history = mergeSessionCandidates(null, buildDateCandidatePool([first, second], state).records,
      { sessionId: "s", turnId: "s:1", observedAt: now,
        shownPlaces: [{ name: "같은 카페", address: "성수 1" }] });
    const reuse = sessionPlaceRecommendationInputs({ session: history,
      ask: { kind: "cafe", query: "카페", area: "성수" }, state,
      message: "다른 카페 보여줘", now });
    expect(reuse.excludedCandidateIds).toEqual(["kakao:a"]);
    expect(reuse.reusable.map(row => row.externalPlaceId)).toEqual(["b"]);
  });

  it("drops stale opening hours and does not reuse stale cost against a numeric budget", () => {
    const old = session([venue("a", { openingHours: "09:00-22:00", expectedCostTwo: 50000 })], [],
      state, "2026-09-24T10:00:00Z");
    expect(currentSessionVenue(old.records[0], now, state)?.openingHours).toBeUndefined();
    expect(currentSessionVenue(old.records[0], now, { ...state, budgetWon: 100000 })).toBeNull();
    const staleEvidence = session([venue("hours", { openingHours: "09:00-22:00" })]);
    staleEvidence.records[0].evidence = [{ venueId: "kakao:hours", attribute: "hours",
      sourceType: "maps", sourceUrl: null, retrievedAt: "2026-09-20T10:00:00Z",
      observedAt: now, observedTurnId: "s:1", freshnessCategory: "time_sensitive",
      confidence: 0.6, verification: "provider" }];
    expect(currentSessionVenue(staleEvidence.records[0], now, state)?.openingHours).toBeUndefined();
  });

  it("does not renew historic fact timestamps merely by showing reused candidates", async () => {
    const observeCandidates = vi.fn();
    await execute({ observeCandidates, recommend: async input => {
      input.observeCandidates(buildDateCandidatePool(input.reusable, state).records);
      return { ...primary, card: { headline: "추천", lines: ["카페"],
        stops: input.reusable.map(row => ({ name: row.name, meta: "카페",
          address: row.roadAddress })) } };
    } });
    expect(observeCandidates).toHaveBeenCalledWith([]);
  });

  it("rechecks numeric budget, excluded places, and excluded foods before reuse", () => {
    const ask = { kind: "cafe" as const, query: "카페", area: "성수" };
    const old = session([venue("cheap", { expectedCostTwo: 40000 }),
      venue("expensive", { expectedCostTwo: 200000 }),
      venue("food", { dishes: "돼지고기 케이크" })]);
    const current = { ...state, budgetWon: 100000, excludedPlaces: ["cheap 카페"],
      excludedFoods: ["돼지고기"] };
    expect(reusablePlaceCandidates({ session: old, ask, state: current,
      message: "다른 카페 보여줘", now })).toEqual([]);
  });

  it("rechecks historical rejections against current hard constraints before revival", () => {
    const rejectedState = { ...state, excludedPlaces: ["a 카페"] };
    const old = session([venue("a")], [], rejectedState);
    const ask = { kind: "cafe" as const, query: "카페", area: "성수" };
    expect(reusablePlaceCandidates({ session: old, ask, state: rejectedState,
      message: "아까 제외한 a 카페 다시 보여줘", now })).toHaveLength(0);
    expect(reusablePlaceCandidates({ session: old, ask, state,
      message: "다른 카페 보여줘", now })).toHaveLength(0);
    expect(reusablePlaceCandidates({ session: old, ask, state,
      message: "아까 제외한 a 카페 다시 보여줘", now }).map(row => row.externalPlaceId)).toEqual(["a"]);
  });

  it("does not run twice when the legacy places route already handled the request", async () => {
    recommend.mockClear();
    const outcome = await execute({ route: { mode: "places", confident: true,
      placeAsk: { kind: "cafe", query: "카페", area: "성수" } } });
    expect(outcome.result).toMatchObject({ status: "skipped", failureCode: "legacy_places_covered" });
    expect(recommend).not.toHaveBeenCalled();
  });

  it("isolates failed recommendation and preserves the original response", async () => {
    const outcome = await execute({ recommend: async () => { throw new Error("search failed"); } });
    expect(outcome.result).toMatchObject({ status: "failed", failureCode: "recommendation_failed" });
    expect(appendPlaceRecommendation(primary, outcome.result)).toBe(primary);
  });

  it("does not execute in off, shadow or non-limited modes", async () => {
    recommend.mockClear();
    expect((await execute({ interpreterMode: "off" })).result.status).toBe("skipped");
    expect((await execute({ interpreterMode: "shadow" })).result.status).toBe("skipped");
    expect((await execute({ executionMode: "shadow" })).result.status).toBe("skipped");
    expect(recommend).not.toHaveBeenCalled();
  });

  it("merges the selected place into the next session turn as shown", () => {
    const before = session([venue("a")]);
    const next = mergeSessionCandidates(before, buildDateCandidatePool([venue("b")], state).records,
      { sessionId: "s", turnId: "s:2", observedAt: now, shownPlaces: [{ name: "b 카페",
        address: "서울 성수 b" }] });
    expect(next.records.find(row => row.candidateId === "kakao:b")?.shownCount).toBe(1);
    expect(next.records.find(row => row.candidateId === "kakao:a")?.shownCount).toBe(0);
  });
});
