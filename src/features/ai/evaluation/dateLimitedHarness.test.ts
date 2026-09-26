import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply, AIPlannerResult } from "@/features/planning/types/plan";
import { buildDateCandidatePool } from "../dateCandidatePool";
import { emptyDateBrief, withAreas } from "../dateBrief";
import { buildDateExecutionPlan } from "../dateExecutionPlan";
import { executeLimitedComparison } from "../datePlaceComparisonExecution";
import { sessionPlaceRecommendationInputs } from "../datePlaceRecommendationExecution";
import { buildDateTurnUnderstanding } from "../dateTurnUnderstanding";
import { mergeSessionCandidates } from "../sessionCandidates";
import { mergeSessionFeedback, placeSessionFeedbackSignals } from "../sessionFeedback";
import { DATE_LIMITED_FIXTURES } from "./dateLimitedFixtures";
import { evaluateLimitedDateTurn } from "./dateLimitedHarness";

const now = "2026-09-26T10:00:00Z";
const state = withAreas(emptyDateBrief(), ["성수"]);
const candidate = (id: string, changes: Partial<DiscoverCandidate> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name: `카페 ${id}`, category: "cafe",
  categoryLabel: "카페", kakaoCategoryGroupCode: "CE7", district: "성수",
  address: `서울 성수 ${id}`, roadAddress: `서울 성수 ${id}`, phone: "", mapUrl: "",
  coordinates: [127.04, 37.56], searchRegion: "성수", ...changes,
});
const pool = [candidate("A"), candidate("B"), candidate("C"),
  candidate("D", { expectedCostTwo: 200000 })];
const session = () => mergeSessionCandidates(null, buildDateCandidatePool(pool, state).records,
  { sessionId: "eval", turnId: "eval:1", observedAt: now,
    shownPlaces: [{ name: "카페 A", address: "서울 성수 A" },
      { name: "카페 B", address: "서울 성수 B" }] });
const currentPlan: AIPlannerReply = { status: "plan", message: "성수 코스",
  card: { headline: "성수 코스", lines: ["저녁과 카페"] },
  condition: { dateLabel: "2026-09-26", startTime: "18:00", endTime: "21:00",
    budget: 100000, region: "성수", timeSpecified: true },
  recommendations: [
    { id: "kakao:dinner", placeId: "discover:kakao:dinner", name: "성수 저녁",
      activitySlot: "meal", category: "식당", district: "성수", address: "서울 성수 저녁",
      phone: "", mapUrl: "", coordinates: [127.04, 37.56], durationMinutes: 60,
      expectedCost: 50000, reasons: [], isSaved: false, distanceFromPreviousMeters: null },
    { id: "kakao:A", placeId: "discover:kakao:A", name: "카페 A",
      activitySlot: "cafe", category: "카페", district: "성수", address: "서울 성수 A",
      phone: "", mapUrl: "", coordinates: [127.0405, 37.56], durationMinutes: 60,
      expectedCost: 20000, reasons: [], isSaved: false, distanceFromPreviousMeters: 200 },
  ],
  items: [
    { id: "dinner", placeId: "discover:kakao:dinner", placeName: "성수 저녁", category: "식당",
      startTime: "18:00", durationMinutes: 60, expectedCost: 50000, order: 0, memo: "", dayIndex: 0 },
    { id: "cafe", placeId: "discover:kakao:A", placeName: "카페 A", category: "카페",
      startTime: "19:30", durationMinutes: 60, expectedCost: 20000, order: 1, memo: "", dayIndex: 0 },
  ], candidateCount: 4, source: "fallback", state };
const primary: AIPlannerResult = { status: "chat", message: "기존 답변",
  card: { headline: "기존", lines: ["기존 답변"] }, state };

describe("limited execution conversation evaluation", () => {
  it("keeps 13 semantic conversation fixtures and reports legacy-only gaps without exact text matching", () => {
    expect(DATE_LIMITED_FIXTURES).toHaveLength(13);
    const reports = DATE_LIMITED_FIXTURES.map(fixture => {
      const message = fixture.turns.at(-1)!;
      const history = fixture.context === "session" ? session() : null;
      const understanding = buildDateTurnUnderstanding({ message, today: "2026-09-26", state,
        currentPlan: fixture.context === "plan" ? currentPlan : null,
        sessionCandidates: history });
      const plan = buildDateExecutionPlan({ understanding,
        currentPlan: fixture.context === "plan" ? currentPlan : null,
        sessionCandidates: history });
      return evaluateLimitedDateTurn({ fixture, understanding, plan,
        primary, merged: primary, taskResults: [], state, sessionCandidates: history, now });
    });
    expect(reports.every(report => Number.isFinite(report.metrics.goalCoverage.matched))).toBe(true);
    expect(reports.find(report => report.scenarioId === "ambiguous_reference")
      ?.metrics.unresolvedReferenceCount).toBeGreaterThan(0);
    expect(reports.some(report => report.missingGoals.length)).toBe(true);
    expect(JSON.stringify(reports)).not.toContain("저녁 바꿔주고");
    if (process.env.DATE_EVAL_REPORT === "true") console.info("date_limited_fixture_report", JSON.stringify({
      scenarioCount: reports.length,
      goalCoverage: reports.reduce((total, report) => total + report.metrics.goalCoverage.matched, 0),
      expectedGoals: reports.reduce((total, report) => total + report.metrics.goalCoverage.expected, 0),
      taskCoverage: reports.reduce((total, report) => total + report.metrics.taskCoverage.planned, 0),
      expectedTasks: reports.reduce((total, report) => total + report.metrics.taskCoverage.expected, 0),
      missingByScenario: reports.filter(report => report.missingGoals.length || report.missingTasks.length)
        .map(report => ({ id: report.scenarioId, missingGoals: report.missingGoals,
          missingTasks: report.missingTasks })),
    }));
  });

  it("A/B/C: a fixed pool avoids shown venues, passes verified noise feedback softly, and keeps budget hard", () => {
    const history = session();
    const ask = { kind: "cafe" as const, query: "카페", area: "성수" };
    // A is the first generic request; B and C must not silently recommend A or B again.
    const generic = buildDateCandidatePool(pool, state).eligible.map(row => row.externalPlaceId);
    const other = sessionPlaceRecommendationInputs({ session: history, ask, state,
      message: "다른 카페 보여줘", now });
    const withFeedback = mergeSessionFeedback(history.feedback, [{
      target: { kind: "place", candidateId: "kakao:A", name: "카페 A" },
      attribute: "noise", sentiment: "negative", strength: 0.9, confidence: 0.9,
      sourceTurn: "eval:2", observedAt: now, source: "llm",
    }]);
    const soft = placeSessionFeedbackSignals(withFeedback, "eval:2");
    const constrained = sessionPlaceRecommendationInputs({ session: history, ask,
      state: { ...state, budgetWon: 100000 }, message: "다른 카페 보여줘", now });
    expect(generic).toEqual(["A", "B", "C", "D"]);
    expect(other.reusable.map(row => row.externalPlaceId)).toEqual(["C", "D"]);
    expect(other.excludedCandidateIds).toEqual(expect.arrayContaining(["kakao:A", "kakao:B"]));
    expect(soft).toEqual([{ attribute: "noise", sentiment: "negative",
      targetName: "카페 A", targetCandidateId: "kakao:A", priority: "current_feedback" }]);
    expect(constrained.reusable.map(row => row.externalPlaceId)).toEqual(["C"]);
  });

  it("D: comparison leaves unsupported noise and stale hours unknown", async () => {
    const history = session();
    for (const row of history.records.slice(0, 2)) {
      row.venue = { ...row.venue!, openingHours: "09:00-22:00" };
      row.facts = [{ ...row.facts[0], observedAt: "2026-09-20T10:00:00Z" }];
    }
    const task = { id: "compare", type: "compare_places" as const, goal: "compare_places" as const,
      targets: [{ kind: "place" as const, name: "카페 A", placeId: "kakao:A" },
        { kind: "place" as const, name: "카페 B", placeId: "kakao:B" }],
      dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned" as const,
      source: "llm" as const };
    const plan = { tasks: [task], unresolved: [], executable: true,
      source: "effective_understanding" as const };
    const outcome = await executeLimitedComparison({ plan, task, route: null, primary,
      interpreterMode: "assist", executionMode: "limited", currentPlan: null, visiblePlaces: [],
      sessionCandidates: history, state, userMessage: "카페 A와 카페 B 영업시간과 소음 비교해줘", now });
    expect(outcome.result.comparedFactTypes).toEqual([]);
    expect(outcome.result.unknownFactTypes).toEqual(["noise", "opening_hours"]);
    expect(outcome.result.lines.join(" ")).not.toContain("09:00-22:00");
  });

  it("flags injected hard violations, duplicate facts, shown repetition and failed dependency handling", () => {
    const fixture = DATE_LIMITED_FIXTURES.find(row => row.id === "other_places")!;
    const history = session();
    const understanding = buildDateTurnUnderstanding({ message: fixture.turns.at(-1)!,
      today: "2026-09-26", state, sessionCandidates: history });
    const plan = buildDateExecutionPlan({ understanding, sessionCandidates: history });
    const flawed = { ...primary, message: "기존 답변 같은 문장 같은 문장",
      card: { ...primary.card, lines: ["기존 답변", "같은 문장", "같은 문장"],
        sources: [{ label: "a", url: "https://example.com/a" },
          { label: "b", url: "https://example.com/a" }] } };
    const metrics = evaluateLimitedDateTurn({ fixture, understanding, plan,
      primary, merged: flawed, state: { ...state, budgetWon: 100000 }, sessionCandidates: history,
      taskResults: [{ taskId: "recommend", taskType: "recommend_places", status: "success",
        source: "existing_place_recommendation", coveredByLegacyRoute: false,
        reusedCount: 0, searched: false, selectedCandidateIds: ["kakao:A", "kakao:D"] },
      { taskId: "recommend-duplicate", taskType: "recommend_places", status: "success",
        source: "existing_place_recommendation", coveredByLegacyRoute: false,
        reusedCount: 0, searched: false, selectedCandidateIds: ["kakao:A", "kakao:D"] }], now }).metrics;
    expect(metrics.duplicateResponseContentCount).toBeGreaterThan(0);
    expect(metrics.duplicateSourceCount).toBe(1);
    expect(metrics.previouslyShownPlaceRepetitionCount).toBe(1);
    expect(metrics.hardConstraintViolationCount).toBe(1);
    expect(metrics.duplicateTaskExecutionCount).toBe(1);
  });

  it("keeps a verified comparison executable beside an unrelated unresolved task", async () => {
    const fixture = DATE_LIMITED_FIXTURES.find(row => row.id === "compare_places")!;
    const history = session();
    const understanding = buildDateTurnUnderstanding({ message: fixture.turns[0],
      today: "2026-09-26", state, sessionCandidates: history });
    const compare = { id: "compare", type: "compare_places" as const, goal: "compare_places" as const,
      targets: [{ kind: "place" as const, name: "카페 A", placeId: "kakao:A" },
        { kind: "place" as const, name: "카페 B", placeId: "kakao:B" }],
      dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned" as const,
      source: "llm" as const };
    const unresolved = { id: "other", type: "inspect_venue" as const, goal: "ask_venue" as const,
      dependencies: [], executionOrder: 2, confidence: 0.9, status: "unresolved" as const,
      source: "llm" as const };
    const plan = { tasks: [compare, unresolved], unresolved: [{ code: "missing_target" as const,
      taskId: "other" }], executable: false, source: "effective_understanding" as const };
    const outcome = await executeLimitedComparison({ plan, task: compare, route: null, primary,
      interpreterMode: "assist", executionMode: "limited", currentPlan: null, visiblePlaces: [],
      sessionCandidates: history, state, userMessage: fixture.turns[0], now });
    expect(outcome.result).toMatchObject({ status: "success" });
    expect(evaluateLimitedDateTurn({ fixture, understanding, plan, primary, merged: primary,
      taskResults: [outcome.result], state, sessionCandidates: history, now })
      .metrics.taskFailureIsolationCount).toBe(0);
  });
});
