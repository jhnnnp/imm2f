import type { DateCandidateRecord } from "./dateCandidatePool";
import type { UnderstandingComparison } from "./dateTurnShadow";
import type { DateGoalType } from "./dateTurnUnderstanding";
import type { SemanticSignalDecision } from "./dateTurnAssist";
import type { DateExecutionIssueCode, DateExecutionTaskType, ExecutionPlanComparison } from "./dateExecutionPlan";
import { candidateSessionCounts, type SessionCandidateContext } from "./sessionCandidates";

/** Records facts and outcomes; observations never authorize task execution. */
export type DateObservation =
  | { type: "candidate_search"; source: DateCandidateRecord["venue"]["externalSource"];
      data: DateCandidateRecord; timestamp: string }
  | { type: "candidate_rejection"; source: "date_candidate_pool";
      data: { candidateId: string; rejectedReasons: string[] }; timestamp: string }
  | { type: "venue_evidence"; source: "date_candidate_pool";
      data: { candidateId: string; evidence: DateCandidateRecord["evidence"] }; timestamp: string }
  | { type: "route_check" | "planner_failure" | "verification_failure";
      source: string; data: unknown; timestamp: string }
  | { type: "understanding_comparison"; source: "date_turn_shadow";
      data: { legacyGoals: DateGoalType[]; llmGoals: DateGoalType[];
        unresolvedReferences: { legacy: number; llm: number }; ambiguityCount: { legacy: number; llm: number };
        constraintConflictCount: number; invalidReferenceProposalCount: number;
        goalAgreement: UnderstandingComparison["goalAgreement"] };
      timestamp: string }
  | { type: "semantic_signal"; source: "date_turn_assist";
      data: SemanticSignalDecision; timestamp: string }
  | { type: "execution_plan"; source: "date_execution_planner";
      data: { taskTypes: DateExecutionTaskType[]; taskCount: number; blockedCount: number;
        validTaskCount?: number; executableTaskCount?: number; dependencyBlockedCount?: number;
        unresolvedCount: number; dependencyCount: number;
        legacyRoute: ExecutionPlanComparison["legacyRoute"];
        routeCoverage: ExecutionPlanComparison["routeCoverage"]; additionalTaskCount: number;
      issueCodes: DateExecutionIssueCode[] };
      timestamp: string }
  | { type: "task_execution"; source: "date_venue_inspection";
      data: { taskType: "inspect_venue"; status: "success" | "skipped" | "failed";
        coveredByLegacyRoute: boolean; evidenceFound: boolean; failureCode: string | null };
      timestamp: string }
  | { type: "task_execution"; source: "date_mutation_execution";
      data: { taskType: "modify_itinerary"; operation: string; status: "success" | "skipped" | "failed";
        coveredByLegacyRoute: boolean; verifiedTarget: boolean; verificationPassed: boolean;
        failureCode: string | null };
      timestamp: string }
  | { type: "task_execution"; source: "date_recommendation_explanation";
      data: { taskType: "explain_recommendation"; status: "success" | "skipped" | "failed";
        targetType: string | null; evidenceCount: number; factTypesUsed: string[];
        coveredByLegacyRoute: boolean; failureCode: string | null };
      timestamp: string }
  | { type: "task_execution"; source: "date_place_recommendation";
      data: { taskType: "recommend_places"; status: "success" | "skipped" | "failed";
        coveredByLegacyRoute: boolean; reusedCount: number; searched: boolean;
        selectedCount: number; failureCode: string | null }; timestamp: string }
  | { type: "task_execution"; source: "date_place_comparison";
      data: { taskType: "compare_places"; status: "success" | "skipped" | "failed";
        targetCount: number; comparedFactTypes: string[]; unknownFactTypes: string[];
        evidenceCount: number; coveredByLegacyRoute: boolean; failureCode: string | null }; timestamp: string }
  | { type: "task_execution"; source: "date_feedback_execution";
      data: { taskType: "record_feedback"; status: "success" | "skipped" | "failed";
        entryCount: number; unresolvedTargetCount: number; failureCode: string | null }; timestamp: string }
  | { type: "task_dispatch"; source: "limited_task_dispatcher";
      data: { plannedCount: number; executableLimitedCount: number; executedCount: number;
        validTaskCount?: number; executableTaskCount?: number; blockedTaskCount?: number;
        dependencyBlockedCount?: number; independentlyExecutedCount?: number;
        successCount: number; failedCount: number; skippedCount: number; dependencySkipCount: number };
      timestamp: string }
  | { type: "candidate_session"; source: "session_candidates";
      data: { totalCandidates: number; newCandidates: number; mergedCandidates: number;
        shownCount: number; selectedCount: number; rejectedCount: number;
        staleCount: number; evidenceCount: number };
      timestamp: string };

/** Preserve each pool record, including rejected candidates, without changing eligibility. */
export function candidateRecordObservations(records: DateCandidateRecord[], timestamp: string): DateObservation[] {
  return records.flatMap(record => {
    const observations: DateObservation[] = [
      { type: "candidate_search", source: record.venue.externalSource, data: record, timestamp },
    ];
    if (record.rejectedReasons.length) observations.push({
      type: "candidate_rejection", source: "date_candidate_pool",
      data: { candidateId: record.id, rejectedReasons: [...record.rejectedReasons] }, timestamp,
    });
    if (record.evidence.length) observations.push({
      type: "venue_evidence", source: "date_candidate_pool",
      data: { candidateId: record.id, evidence: [...record.evidence] }, timestamp,
    });
    return observations;
  });
}

/** Aggregate only counts, never the user's text or the evidence excerpts. */
export function candidateSessionObservation(previous: SessionCandidateContext | null,
  current: SessionCandidateContext, records: DateCandidateRecord[], timestamp: string): DateObservation {
  const before = new Set(previous?.records.map(record => record.candidateId) ?? []);
  const unique = new Set(records.map(record => record.id));
  const newCandidates = [...unique].filter(id => !before.has(id)).length;
  return { type: "candidate_session", source: "session_candidates", timestamp,
    data: { ...candidateSessionCounts(current), newCandidates,
      mergedCandidates: unique.size - newCandidates } };
}
