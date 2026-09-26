import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply, AIPlannerState, PlanItem } from "@/features/planning/types/plan";
import type { ArchivedDatePlan } from "@/features/planning/actions";
import type { TasteBoard } from "@/features/taste/types";
import { emptyDateBrief } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { buildDateContext } from "./dateContext";
import { toDateIntent } from "./dateIntent";
import { collectDateMemory } from "./dateMemory";

const observedAt = "2026-09-26T00:00:00.000Z";
const taste: TasteBoard = { you: null, partner: null, youName: "나", partnerName: "상대",
  partnerConnected: false, compare: null };
const venue = (id: string, name: string, changes: Partial<DiscoverCandidate> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name, category: "restaurant", categoryLabel: "식당",
  district: "성동구", address: "서울 성동구", roadAddress: "서울 성동구", phone: "", mapUrl: "",
  coordinates: [127.04, 37.56], ...changes,
});
const state = (): AIPlannerState => ({ ...emptyDateBrief(), objective: "조용히 대화하는 데이트",
  areas: ["성수"], region: "성수", regions: ["성수"], dateLabel: "2026-09-26",
  startTime: "14:00", endTime: "19:00", budgetWon: 80000,
  requiredPlaces: ["정원 카페"], excludedPlaces: ["피할 식당"], excludedFoods: ["새우"],
  activities: ["cafe"], preferences: { vibe: ["조용한"], crowdTolerance: 0.2 },
  inferredPreferences: [{ value: "대화 중심", evidence: "조용히 대화", confidence: 0.8 }],
});
const item: PlanItem = { id: "one", placeId: "discover:kakao:1", placeName: "정원 카페",
  category: "카페", startTime: "14:00", durationMinutes: 60, expectedCost: 0,
  order: 0, memo: "", dayIndex: 0 };
const currentPlan = (planState: AIPlannerState): AIPlannerReply => ({
  status: "plan", message: "기존 코스", card: { headline: "성수", lines: ["기존 코스"] },
  condition: { dateLabel: "2026-09-26", startTime: "14:00", endTime: "19:00", budget: 80000,
    region: "성수", timeSpecified: true },
  recommendations: [], items: [item], candidateCount: 1, source: "fallback", state: planState,
});

describe("date context read model", () => {
  it("adapts planner state and recent conversation without replacing the state", () => {
    const original = state();
    const conversation = [{ role: "user" as const, text: "성수에서 조용히 대화하고 싶어" }];
    const context = buildDateContext({ state: original, conversation, observedAt });
    expect(context.objective).toBe(original.objective);
    expect(context.conversation).toEqual(conversation);
    expect(original).toEqual(state());
  });

  it("preserves every existing hard constraint through DateIntent", () => {
    const original = state();
    const context = buildDateContext({ state: original, observedAt });
    expect(context.hardConstraints).toEqual(toDateIntent(original).hardConstraints);
  });

  it("preserves explicit soft preferences", () => {
    const original = state();
    const context = buildDateContext({ state: original, observedAt });
    expect(context.softPreferences).toEqual(original.preferences);
  });

  it("preserves inferred preferences with their evidence and confidence", () => {
    const original = state();
    const context = buildDateContext({ state: original, observedAt });
    expect(context.inferredPreferences).toEqual(original.inferredPreferences);
  });

  it("exposes the existing collected memory and archived source", () => {
    const archives: ArchivedDatePlan[] = [{ id: "archive-1", title: "성수", date: "2026-09-01",
      notes: "정원 카페는 좋았어", items: [item] }];
    const memory = collectDateMemory({ taste, archives, userRequests: [], currentPlaces: [] });
    const context = buildDateContext({ state: state(), tasteBoard: taste, archives, memory, observedAt });
    expect(context.coupleContext.tasteBoard).toBe(taste);
    expect(context.coupleContext.explicitProfile).toEqual(memory.explicitProfile);
    expect(context.relevantMemories.collected).toEqual(memory);
    expect(context.relevantMemories.archivedPlans).toEqual(archives);
  });

  it("preserves the current plan as a read-only input", () => {
    const original = state();
    const plan = currentPlan(original);
    expect(buildDateContext({ state: original, currentPlan: plan, observedAt }).currentPlan).toBe(plan);
  });

  it("turns complete candidate records into timestamped observations", () => {
    const candidate = venue("1", "정원 카페", { category: "cafe", categoryLabel: "카페",
      evidence: [{ id: "e1", venueId: "kakao:1", attribute: "space", text: "정원 좌석",
        url: "https://example.com/1", checkedAt: observedAt, verification: "source_checked" }] });
    const pool = buildDateCandidatePool([candidate], emptyDateBrief());
    const context = buildDateContext({ state: emptyDateBrief(), candidatePool: pool, observedAt });
    expect(context.candidates.records).toEqual(pool.records);
    expect(context.facts[0]).toEqual({ id: "kakao:1", facts: pool.records[0].facts, evidence: pool.records[0].evidence });
    expect(context.observations).toContainEqual({ type: "candidate_search", source: "kakao",
      data: pool.records[0], timestamp: observedAt });
    expect(context.observations).toContainEqual({ type: "venue_evidence", source: "date_candidate_pool",
      data: { candidateId: "kakao:1", evidence: pool.records[0].evidence }, timestamp: observedAt });
  });

  it("retains rejected candidate reasons without treating them as eligible", () => {
    const original = { ...emptyDateBrief(), excludedPlaces: ["피할 식당"] };
    const pool = buildDateCandidatePool([venue("2", "피할 식당")], original);
    const context = buildDateContext({ state: original, candidatePool: pool, observedAt });
    expect(context.candidates.records[0].rejectedReasons).toEqual(["excluded_place"]);
    expect(context.observations).toContainEqual({ type: "candidate_rejection", source: "date_candidate_pool",
      data: { candidateId: "kakao:2", rejectedReasons: ["excluded_place"] }, timestamp: observedAt });
    expect(context.candidates.eligibleIds).toEqual([]);
  });

  it("leaves the pool's eligible result and ordering unchanged", () => {
    const original = { ...emptyDateBrief(), excludedPlaces: ["피할 식당"] };
    const candidates = [venue("1", "첫 식당"), venue("2", "피할 식당"), venue("3", "셋째 식당")];
    const pool = buildDateCandidatePool(candidates, original);
    const before = [...pool.eligible];
    const context = buildDateContext({ state: original, candidatePool: pool, observedAt });
    expect(pool.eligible).toEqual(before);
    expect(pool.eligible[0]).toBe(before[0]);
    expect(context.candidates.eligibleIds).toEqual(["kakao:1", "kakao:3"]);
  });
});
