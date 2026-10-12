import { describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerResult } from "@/features/planning/types/plan";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { buildDateExecutionPlan, type DateExecutionPlan, type DateExecutionTask } from "./dateExecutionPlan";
import type { DateTurnUnderstanding } from "./dateTurnUnderstanding";
import { appendPlaceComparison, executeLimitedComparison,
  legacyComparisonCovered } from "./datePlaceComparisonExecution";
import { mergeSessionCandidates } from "./sessionCandidates";

const now = "2026-09-26T10:00:00Z";
const state = withAreas(emptyDateBrief(), ["성수"]);
const venue = (id: string): DiscoverCandidate => ({ externalSource: "kakao", externalPlaceId: id,
  name: `${id} 카페`, category: "cafe", categoryLabel: "카페", kakaoCategoryGroupCode: "CE7",
  district: "성수", address: `서울 성수 ${id}`, roadAddress: `서울 성수 ${id}`,
  phone: "", mapUrl: "", coordinates: [127.04, 37.56], searchRegion: "성수" });
const session = () => mergeSessionCandidates(null, buildDateCandidatePool([venue("a"), venue("b")], state).records,
  { sessionId: "s", turnId: "s:1", observedAt: now,
    shownPlaces: [{ name: "a 카페", address: "서울 성수 a" },
      { name: "b 카페", address: "서울 성수 b" }] });
const task: DateExecutionTask = { id: "compare", type: "compare_places", goal: "compare_places",
  targets: [{ kind: "place", name: "a 카페", placeId: "kakao:a" },
    { kind: "place", name: "b 카페", placeId: "kakao:b" }],
  dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned", source: "llm" };
const plan: DateExecutionPlan = { tasks: [task], executable: true, unresolved: [],
  source: "effective_understanding" };
const primary: AIPlannerResult = { status: "chat", message: "기존 답변",
  card: { headline: "기존", lines: ["기존 답변"] }, state };
const run = (overrides: Partial<Parameters<typeof executeLimitedComparison>[0]> = {}) =>
  executeLimitedComparison({ plan, task, route: { mode: "course", confident: true }, primary,
    interpreterMode: "assist", executionMode: "limited", currentPlan: null, visiblePlaces: [],
    sessionCandidates: session(), state, userMessage: "A랑 B 중 어디가 더 조용해?", now,
    ...overrides });

describe("limited evidence-grounded place comparison", () => {
  it("compares two verified session places when model reasoning is unavailable", async () => {
    const current = session();
    current.records[0].evidence.push({ venueId: "kakao:a", attribute: "space", sourceType: "web",
      sourceUrl: "https://example.com/a", retrievedAt: now, observedAt: now, observedTurnId: "s:1",
      freshnessCategory: "stable", confidence: 0.8, verification: "source_checked",
      excerpt: "대화하기 조용한 실내" });
    current.records[1].evidence.push({ venueId: "kakao:b", attribute: "space", sourceType: "web",
      sourceUrl: "https://example.com/b", retrievedAt: now, observedAt: now, observedTurnId: "s:1",
      freshnessCategory: "stable", confidence: 0.8, verification: "source_checked",
      excerpt: "사람이 많고 시끄러운 실내" });
    const outcome = await run({ sessionCandidates: current });
    expect(outcome.result).toMatchObject({ status: "success", candidateIds: ["kakao:a", "kakao:b"],
      comparedFactTypes: ["noise"], evidenceCount: 2 });
    expect(appendPlaceComparison(primary, outcome.result).card.lines.at(-1)).toContain("장소 비교:");
  });

  it("preserves negation and finds the evidence that actually addresses the requested criterion", async () => {
    const current = session();
    for (const row of current.records) {
      const base = { venueId: row.candidateId, attribute: "space" as const, sourceType: "web" as const,
        sourceUrl: `https://example.com/${row.candidateId}`, retrievedAt: now, observedAt: now,
        observedTurnId: "s:1", freshnessCategory: "stable" as const, confidence: 0.8,
        verification: "source_checked" as const };
      row.evidence.push({ ...base, excerpt: "감성적인 분위기의 인테리어" },
        { ...base, excerpt: "조용하지 않고 음악 소리가 커요." });
    }
    const outcome = await run({ sessionCandidates: current });
    expect(outcome.result.comparedFactTypes).toEqual(["noise"]);
    expect(outcome.result.lines.join(" ")).toContain("조용하지 않고 음악 소리가 커요");
    expect(outcome.result.lines.join(" ")).not.toContain("자료에 '조용' 언급");
  });

  it("keeps an available venue fact even when the other venue's fact is unknown", async () => {
    const current = session();
    current.records[0].evidence.push({ venueId: "kakao:a", attribute: "space", sourceType: "web",
      sourceUrl: "https://example.com/a", retrievedAt: now, observedAt: now, observedTurnId: "s:1",
      freshnessCategory: "stable", confidence: 0.8, verification: "source_checked",
      excerpt: "대화하기 조용한 실내" });
    const outcome = await run({ sessionCandidates: current });
    expect(outcome.result).toMatchObject({ comparedFactTypes: [], unknownFactTypes: ["noise"], evidenceCount: 1 });
    expect(outcome.result.lines.join(" ")).toContain("a 카페 확인된 자료: 대화하기 조용한 실내");
    expect(outcome.result.lines.join(" ")).toContain("b 카페 아직 확인되지 않았어요");
    expect(outcome.result.sources).toEqual([{ label: "장소 비교 근거", url: "https://example.com/a" }]);
  });

  it("uses model reasoning over verified facts to answer the user's choice rather than concatenating fields", async () => {
    const current = session();
    current.records.forEach((row, index) => row.evidence.push({ venueId: row.candidateId,
      attribute: "space", sourceType: "web", sourceUrl: `https://example.com/${index}`,
      retrievedAt: now, observedAt: now, observedTurnId: "s:1", freshnessCategory: "stable",
      confidence: 0.8, verification: "source_checked",
      excerpt: index === 0 ? "조용하지 않고 음악 소리가 커요." : "조용하게 대화할 수 있어요." }));
    const reason = vi.fn(async () => ({ text: "대화가 목적이면 b 카페를 먼저 고려할 수 있어요.",
      usedFactIds: ["noise-0", "noise-1"] }));
    const outcome = await executeLimitedComparison({ plan, task, route: { mode: "course", confident: true }, primary,
      interpreterMode: "assist", executionMode: "limited", currentPlan: null, visiblePlaces: [],
      sessionCandidates: current, state, userMessage: "A랑 B 중 어디가 더 조용해?", now }, reason);
    expect(reason).toHaveBeenCalledWith(expect.objectContaining({ purpose: "comparison",
      message: "A랑 B 중 어디가 더 조용해?", facts: expect.arrayContaining([
        expect.objectContaining({ id: "noise-0", summary: expect.stringContaining("조용하지 않고") }),
      ]) }));
    expect(outcome.result.lines).toEqual(["대화가 목적이면 b 카페를 먼저 고려할 수 있어요."]);
    expect(outcome.result.evidenceCount).toBe(2);
  });

  it("rejects evidence for another venue, unsafe sources and low confidence", async () => {
    const current = session();
    for (const row of current.records) {
      const base = { venueId: row.candidateId, attribute: "space" as const, sourceType: "web" as const,
        sourceUrl: "https://example.com/a", retrievedAt: now, observedAt: now,
        observedTurnId: "s:1", freshnessCategory: "stable" as const, confidence: 0.8,
        verification: "source_checked" as const, excerpt: "조용한 실내" };
      row.evidence.push({ ...base, venueId: "kakao:other" },
        { ...base, sourceUrl: "javascript:alert(1)" }, { ...base, confidence: 0.4 });
    }
    expect((await run({ sessionCandidates: current })).result).toMatchObject({ comparedFactTypes: [],
      unknownFactTypes: ["noise"], evidenceCount: 0, sources: [] });
  });

  it("keeps unevidenced noise unknown instead of claiming one place is quieter", async () => {
    const outcome = await run();
    expect(outcome.result).toMatchObject({ status: "success", comparedFactTypes: [],
      unknownFactTypes: ["noise"], evidenceCount: 0 });
    expect(outcome.result.lines.join(" ")).not.toMatch(/더 조용|조용해서/);
  });

  it("treats stale opening hours as unknown", async () => {
    const current = session();
    for (const row of current.records) {
      row.venue = { ...row.venue!, openingHours: "09:00-22:00" };
      row.facts = [{ ...row.facts[0], observedAt: "2026-09-20T10:00:00Z" }];
      row.evidence.push({ venueId: row.candidateId, attribute: "hours", sourceType: "maps",
        sourceUrl: null, retrievedAt: "2026-09-20T10:00:00Z", observedAt: now,
        observedTurnId: "s:1", freshnessCategory: "time_sensitive", confidence: 0.6,
        verification: "provider" });
    }
    const outcome = await run({ sessionCandidates: current, userMessage: "A와 B 영업시간 비교해줘" });
    expect(outcome.result.unknownFactTypes).toContain("opening_hours");
    expect(outcome.result.lines.join(" ")).not.toContain("09:00-22:00");
  });

  it("skips if one target is unresolved or a model-invented ID", async () => {
    const altered = { ...task, targets: [task.targets![0],
      { kind: "place" as const, name: "b 카페", placeId: "kakao:hallucinated" }] };
    const outcome = await run({ task: altered, plan: { ...plan, tasks: [altered] } });
    expect(outcome.result.status).toBe("skipped");
  });

  it("dedupes only a legacy answer covering the actual names and criterion", async () => {
    const questionRoute = { mode: "question" as const, confident: true };
    const covered = { ...primary, message: "비교", card: { headline: "비교",
      lines: ["a 카페와 b 카페의 소음을 비교하면 a 카페가 더 조용해요."] } };
    expect(legacyComparisonCovered(questionRoute, covered, ["a 카페", "b 카페"], ["noise"])).toBe(true);
    expect(legacyComparisonCovered(questionRoute, covered, ["a 카페", "b 카페"], ["parking"])).toBe(false);
    const outcome = await run({ route: questionRoute, primary: covered });
    expect(outcome.result).toMatchObject({ status: "skipped", coveredByLegacyRoute: true,
      failureCode: "legacy_comparison_covered" });
  });

  it("runs only in ASSIST and limited mode", async () => {
    expect((await run({ interpreterMode: "off" })).result.status).toBe("skipped");
    expect((await run({ interpreterMode: "shadow" })).result.status).toBe("skipped");
    expect((await run({ executionMode: "shadow" })).result.status).toBe("skipped");
  });

  it("builds separate compare and feedback tasks from verified session references", () => {
    const refs = ["a", "b"].map(id => ({ kind: "previous_place" as const,
      text: `${id} 카페`, resolvedId: `kakao:${id}`, resolvedName: `${id} 카페`,
      targetType: "place" as const, confidence: 0.9 }));
    const understanding: DateTurnUnderstanding = { rawMessage: "a 카페와 b 카페 중 어디가 나아? 그리고 a 카페는 시끄러웠어",
      goals: [{ type: "compare_places", confidence: 0.9 },
        { type: "provide_feedback", confidence: 0.9 }], references: refs,
      explicitConstraints: {}, semanticPreferences: [], requestedChanges: [], ambiguities: [],
      feedback: [{ target: refs[0], attribute: "noise", sentiment: "negative",
        strength: 0.9, confidence: 0.9, explicit: true, evidenceText: "시끄러웠어" }],
      confidence: 0.9, provenance: [] };
    const execution = buildDateExecutionPlan({ understanding, sessionCandidates: session() });
    expect(execution.executable).toBe(true);
    expect(execution.tasks.map(row => row.type)).toEqual(["compare_places", "record_feedback"]);
    expect(execution.tasks[0].targets?.map(row => row.placeId)).toEqual(["kakao:a", "kakao:b"]);
    expect(execution.tasks[1].feedback?.[0].target?.placeId).toBe("kakao:a");
  });
});
