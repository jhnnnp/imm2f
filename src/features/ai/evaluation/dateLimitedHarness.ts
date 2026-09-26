import type { AIPlannerResult, AIPlannerState } from "@/features/planning/types/plan";
import { buildDateCandidatePool } from "../dateCandidatePool";
import type { DateExecutionPlan } from "../dateExecutionPlan";
import type { LimitedTaskResult } from "../dateTaskDispatcher";
import type { DateTurnUnderstanding } from "../dateTurnUnderstanding";
import { isSessionEvidenceStale, type SessionCandidateContext } from "../sessionCandidates";
import type { DateLimitedFixture } from "./dateLimitedFixtures";

export type DateLimitedEvaluationInput = {
  fixture: DateLimitedFixture;
  understanding: DateTurnUnderstanding;
  plan: DateExecutionPlan;
  primary: AIPlannerResult;
  merged: AIPlannerResult;
  taskResults: LimitedTaskResult[];
  state: AIPlannerState;
  sessionCandidates?: SessionCandidateContext | null;
  now: string;
};
export type DateLimitedMetrics = {
  goalCoverage: { matched: number; expected: number };
  taskCoverage: { planned: number; fulfilled: number; expected: number };
  unresolvedReferenceCount: number;
  duplicateTaskExecutionCount: number;
  duplicateResponseContentCount: number;
  duplicateSourceCount: number;
  hardConstraintViolationCount: number;
  unsupportedFactualClaimCount: number;
  staleEvidenceMisuseCount: number;
  previouslyShownPlaceRepetitionCount: number;
  feedbackInconsistencyCount: number;
  dependencyFailureCount: number;
  primaryPreservationFailureCount: number;
  taskFailureIsolationCount: number;
};
export type DateLimitedEvaluation = { scenarioId: string; metrics: DateLimitedMetrics;
  missingGoals: DateLimitedFixture["expectedGoals"];
  missingTasks: DateLimitedFixture["expectedTasks"] };

const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const duplicateCount = (items: string[]) => items.length - new Set(items.map(compact)).size;
const countIn = (text: string, fragment: string) => fragment && text
  ? text.split(fragment).length - 1 : 0;
const executionKey = (row: LimitedTaskResult) => {
  if (row.taskType === "inspect_venue" && "data" in row && row.data)
    return `inspect:${row.data.request.venueId ?? row.data.request.venueName}:${row.data.request.questionType}`;
  if (row.taskType === "compare_places" && "candidateIds" in row)
    return `compare:${[...row.candidateIds].sort().join(",")}:${[...row.comparedFactTypes].sort().join(",")}`;
  if (row.taskType === "recommend_places" && "selectedCandidateIds" in row)
    return `recommend:${[...row.selectedCandidateIds].sort().join(",")}`;
  return row.taskId;
};

/** Pure, deterministic audit of structured outcomes. It does not judge free-form model quality. */
export function evaluateLimitedDateTurn(input: DateLimitedEvaluationInput): DateLimitedEvaluation {
  const { fixture, understanding, plan, primary, merged, taskResults, sessionCandidates, state, now } = input;
  const goals = new Set(understanding.goals.map(goal => goal.type));
  const planned = new Set(plan.tasks.map(task => task.type));
  const fulfilled = new Set(taskResults.filter(row => row.status === "success" || row.coveredByLegacyRoute)
    .map(row => row.taskType));
  const missingGoals = fixture.expectedGoals.filter(type => !goals.has(type));
  const missingTasks = fixture.expectedTasks.filter(type => !planned.has(type));
  const successful = taskResults.filter(row => row.status === "success");
  const selectedIds = [...new Set(successful.filter(row => row.taskType === "recommend_places")
    .flatMap(row => "selectedCandidateIds" in row ? row.selectedCandidateIds : []))];
  const historical = new Map(sessionCandidates?.records.map(row => [row.candidateId, row]) ?? []);
  const hardConstraintViolationCount = selectedIds.filter(id => {
    const venue = historical.get(id)?.venue;
    return venue && buildDateCandidatePool([venue], state).records[0]?.rejectedReasons.length;
  }).length;
  const comparison = successful.filter(row => row.taskType === "compare_places"
    && "comparedFactTypes" in row);
  const unsupportedFactualClaimCount = comparison.reduce((count, row) => {
    if (!("comparedFactTypes" in row)) return count;
    const softFacts = row.comparedFactTypes.filter(type => ["noise", "crowd", "atmosphere", "menu"].includes(type));
    return count + (softFacts.length && row.evidenceCount < row.candidateIds.length ? softFacts.length : 0)
      + (row.unknownFactTypes.includes("noise") && /(?:더\s*조용|더\s*시끄러)/.test(row.lines.join(" ")) ? 1 : 0);
  }, 0);
  const staleEvidenceMisuseCount = comparison.reduce((count, row) => {
    if (!("comparedFactTypes" in row)) return count;
    return count + row.candidateIds.reduce((places, id) => {
      const record = historical.get(id);
      if (!record) return places;
      return places + row.comparedFactTypes.filter(type => {
        const attribute = type === "opening_hours" ? "hours" : type === "price" ? "price" : null;
        if (!attribute) return false;
        const evidence = record.evidence.filter(item => item.attribute === attribute);
        return evidence.length > 0 && evidence.every(item => isSessionEvidenceStale(item, now));
      }).length;
    }, 0);
  }, 0);
  const feedback = successful.filter(row => row.taskType === "record_feedback" && "entries" in row)
    .flatMap(row => "entries" in row ? row.entries : []);
  const feedbackPool = [...(sessionCandidates?.feedback?.entries ?? []), ...feedback];
  const feedbackInconsistencyCount = (fixture.expectedFeedback ?? []).filter(expected =>
    !feedbackPool.some(item => item.attribute === expected.attribute
      && item.sentiment === expected.sentiment)).length;
  const byId = new Map(taskResults.map(row => [row.taskId, row]));
  const dependencyFailureCount = plan.tasks.filter(task => task.dependencies.some(id =>
    byId.get(id)?.status !== "success") && byId.get(task.id)?.status !== "skipped").length;
  const mutationSucceeded = successful.some(row => row.taskType === "modify_itinerary");
  const primaryPreservationFailureCount = mutationSucceeded ? 0 : Number(merged.status !== primary.status
    || JSON.stringify(merged.state) !== JSON.stringify(primary.state)
    || primary.status === "plan" && merged.status === "plan"
      && JSON.stringify(merged.items) !== JSON.stringify(primary.items));
  const addedLines = merged.card.lines.slice(primary.card.lines.length);
  const duplicateResponseContentCount = duplicateCount(merged.card.lines)
    + addedLines.reduce((count, line) => count + Math.max(0, countIn(merged.message, line) - 1), 0);
  const duplicateTaskExecutionCount = successful.length - new Set(successful.map(executionKey)).size;
  const previouslyShownPlaceRepetitionCount = fixture.avoidPreviouslyShown
    ? selectedIds.filter(id => sessionCandidates?.shownCandidateIds.includes(id)).length : 0;
  const independentGlobalPlanSkips = taskResults.filter(row => row.status === "skipped"
    && row.failureCode === "invalid_plan"
    && plan.tasks.some(task => task.id === row.taskId && !task.dependencies.length)
    && plan.unresolved.length > 0
    && plan.unresolved.every(issue => issue.taskId !== row.taskId)).length;
  const taskFailureIsolationCount = independentGlobalPlanSkips
    + (taskResults.some(row => row.status === "failed") ? primaryPreservationFailureCount : 0);
  return { scenarioId: fixture.id, missingGoals, missingTasks, metrics: {
    goalCoverage: { matched: fixture.expectedGoals.length - missingGoals.length,
      expected: fixture.expectedGoals.length },
    taskCoverage: { planned: fixture.expectedTasks.length - missingTasks.length,
      fulfilled: fixture.expectedTasks.filter(type => fulfilled.has(type)).length,
      expected: fixture.expectedTasks.length },
    unresolvedReferenceCount: understanding.references.filter(ref => ref.kind === "unresolved").length,
    duplicateTaskExecutionCount, duplicateResponseContentCount,
    duplicateSourceCount: duplicateCount((merged.card.sources ?? []).map(source => source.url)),
    hardConstraintViolationCount, unsupportedFactualClaimCount, staleEvidenceMisuseCount,
    previouslyShownPlaceRepetitionCount, feedbackInconsistencyCount,
    dependencyFailureCount, primaryPreservationFailureCount, taskFailureIsolationCount,
  } };
}
