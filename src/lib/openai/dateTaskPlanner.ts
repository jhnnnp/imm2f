import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { candidateActivitySlot, dateCandidateKey } from "@/features/ai/dateCourse";
import { dateResearchCallKey, needsDateResearch, planNextDateResearch, type DateResearchToolCall } from "./dateResearchAgent";

export type DateTaskObjective = {
  id: "candidate_coverage" | "event_date" | "food_restriction" | "weather" | "budget"
    | "schedule" | "route" | "venue_evidence" | "preference_fit";
  reason: string;
  required: boolean;
};

/** Explicit obligations stay in the plan even if the model omits them. */
export function dateTaskObjectives(state: AIPlannerState): DateTaskObjective[] {
  const requests = (state.userRequests?.length ? state.userRequests : state.conversationNotes).join(" ");
  const tasks: DateTaskObjective[] = [
    { id: "candidate_coverage", reason: "서로 다른 경험과 선택 가능한 장소 확보", required: true },
    { id: "venue_evidence", reason: "선택할 지점의 속성별 근거 확인", required: true },
  ];
  if (state.objective || state.preferences?.vibe.length || state.inferredPreferences?.length) {
    tasks.push({ id: "preference_fit", reason: "목표와 추론 선호에 맞는 후보 비교", required: false });
  }
  if (state.dateLabel && state.activities.some(activity => activity === "performance" || activity === "exhibit")) {
    tasks.push({ id: "event_date", reason: "방문일 행사 또는 전시 사실 확인", required: true });
  }
  if (state.excludedFoods?.length || state.foodAllergy) {
    tasks.push({ id: "food_restriction", reason: "금지 음식과 알레르기 안전성 검사", required: true });
  }
  if (/비\s*(?:오|온|올)|우천|날씨|눈\s*(?:오|온|올)|폭염|한파/.test(requests)) {
    tasks.push({ id: "weather", reason: "방문일 날씨와 실내 대안 확인", required: true });
  }
  if (state.budgetWon != null) tasks.push({ id: "budget", reason: "두 사람의 알려진 비용과 예산 비교", required: true });
  if (state.startTime || state.endTime) tasks.push({ id: "schedule", reason: "각 장소 체류와 종료 시각 검사", required: true });
  if (state.walkingPreference || state.startTime || state.endTime) {
    tasks.push({ id: "route", reason: "장소 간 실제 이동 거리와 소요 시간 검사", required: true });
  }
  return tasks;
}

export type DatePlanningObservation = {
  candidates: DiscoverCandidate[];
  missingActivities: DateActivityId[];
};

export type DatePlanningStep = {
  round: number;
  calls: DateResearchToolCall[];
  beforeCandidates: number;
  afterCandidates: number;
  missingBefore: DateActivityId[];
  missingAfter: DateActivityId[];
  newCandidateIds: string[];
  newVerifiedEvents: number;
  newDetailedPlaces: number;
};

export type DateTaskPlanResult = {
  objectives: DateTaskObjective[];
  observation: DatePlanningObservation;
  steps: DatePlanningStep[];
  stopReason: "satisfied" | "planner_done" | "no_progress" | "budget_exhausted";
  unresolvedActivities: DateActivityId[];
};

/**
 * Bounded observe-plan-act loop. The planner sees the result of each search
 * before choosing another one; the caller owns the actual provider tools.
 */
export async function runDateTaskPlanner(input: {
  state: AIPlannerState;
  regions: string[];
  attempted: Set<string>;
  observe: () => DatePlanningObservation;
  execute: (calls: DateResearchToolCall[]) => Promise<void>;
  nextActions?: typeof planNextDateResearch;
  maxRounds?: number;
  maxCalls?: number;
  canVerifyPerformances?: boolean;
  canInspectPlaces?: boolean;
}): Promise<DateTaskPlanResult> {
  const nextActions = input.nextActions ?? planNextDateResearch;
  const objectives = dateTaskObjectives(input.state);
  const maxRounds = Math.min(3, Math.max(1, input.maxRounds ?? 2));
  const maxCalls = Math.min(12, Math.max(1, input.maxCalls ?? 8));
  const steps: DatePlanningStep[] = [];
  let observation = input.observe();
  let stopReason: DateTaskPlanResult["stopReason"] = "budget_exhausted";
  let callsUsed = 0;
  const hasPendingPerformance = () => Boolean(input.canVerifyPerformances && input.state.dateLabel
    && input.state.activities.includes("performance")
    && observation.candidates.some(candidate => candidateActivitySlot(candidate) === "performance"
      && !candidate.performanceEvent && !input.attempted.has(`verify_performance:${dateCandidateKey(candidate)}`)));
  const hasPendingDetails = () => Boolean(input.canInspectPlaces
    && (input.state.budgetWon != null || input.state.startTime || input.state.endTime)
    && observation.candidates.some(candidate => (!candidate.openingHours || candidate.expectedCostTwo == null)
      && !input.attempted.has(`get_place_details:${dateCandidateKey(candidate)}`)));

  for (let round = 0; round < maxRounds && callsUsed < maxCalls; round++) {
    if (!needsDateResearch(input.state, observation.candidates.length, observation.missingActivities, round)
      && !hasPendingPerformance() && !hasPendingDetails()) {
      stopReason = "satisfied";
      break;
    }
    const proposed = await nextActions({
      state: input.state, candidates: observation.candidates, regions: input.regions,
      missing: observation.missingActivities, attempted: input.attempted,
      previousSteps: steps, objectives, canVerifyPerformances: input.canVerifyPerformances,
      canInspectPlaces: input.canInspectPlaces,
    });
    const calls = proposed.slice(0, Math.min(4, maxCalls - callsUsed));
    if (!calls.length) {
      stopReason = "planner_done";
      break;
    }
    callsUsed += calls.length;
    calls.forEach(call => input.attempted.add(dateResearchCallKey(call)));
    const before = observation;
    const beforeIds = new Set(before.candidates.map(dateCandidateKey));
    const verifiedBefore = before.candidates.filter(candidate => candidate.performanceEvent).length;
    const detailedBefore = before.candidates.filter(candidate => candidate.openingHours || candidate.expectedCostTwo != null).length;
    await input.execute(calls);
    observation = input.observe();
    const newCandidateIds = observation.candidates.map(dateCandidateKey).filter(id => !beforeIds.has(id));
    const newVerifiedEvents = Math.max(0, observation.candidates.filter(candidate => candidate.performanceEvent).length - verifiedBefore);
    const newDetailedPlaces = Math.max(0, observation.candidates.filter(candidate => candidate.openingHours || candidate.expectedCostTwo != null).length - detailedBefore);
    steps.push({ round, calls, beforeCandidates: before.candidates.length,
      afterCandidates: observation.candidates.length,
      missingBefore: before.missingActivities, missingAfter: observation.missingActivities,
      newCandidateIds, newVerifiedEvents, newDetailedPlaces });
    // A failed search or a duplicate-only search should not spend another model turn.
    if (!newCandidateIds.length && !newVerifiedEvents && !newDetailedPlaces
      && observation.missingActivities.length >= before.missingActivities.length
      && !calls.some(call => call.tool === "verify_performance")) {
      stopReason = "no_progress";
      break;
    }
  }

  if (stopReason === "budget_exhausted"
    && !needsDateResearch(input.state, observation.candidates.length, observation.missingActivities, 1)
    && !hasPendingPerformance() && !hasPendingDetails()) {
    stopReason = "satisfied";
  }
  return { objectives, observation, steps, stopReason, unresolvedActivities: observation.missingActivities };
}
