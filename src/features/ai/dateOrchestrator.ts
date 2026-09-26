import type { AIChatStop, AIPlannerReply, AIPlannerResult } from "@/features/planning/types/plan";
import type { ChatRoute } from "./chatRoute";
import type { DateContext } from "./dateContext";
import { observeDateExecutionPlan, validateDateExecutionStructure,
  type DateExecutionPlan } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";
import { dispatchLimitedDateTasks, type DateTaskExecutionContext,
  type DateTaskDispatchOutput, type LimitedTaskExecutors,
  type LimitedTaskResult } from "./dateTaskDispatcher";
import type { DateExecutionMode } from "./dateVenueInspection";
import type { SessionFeedbackEntry } from "./sessionFeedback";

export type DateOrchestrationSummary = {
  primaryRoute: ChatRoute["mode"] | null;
  plannedTaskCount: number;
  executableTaskCount: number;
  executedTaskCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  dependencyBlockedCount: number;
};

export type DateOrchestrationRequest = {
  /** ChatRoute has already chosen this primary capability. */
  executePrimary: () => AIPlannerResult | Promise<AIPlannerResult>;
  legacyRoute: ChatRoute | null;
  executionMode: DateExecutionMode;
  executionPlan: DateExecutionPlan | null;
  taskContext?: (primaryResult: AIPlannerResult) => DateTaskExecutionContext;
  /** The current planning session only; no persistent memory writes. */
  session?: { feedbackEntries: SessionFeedbackEntry[];
    supplementaryShown: Array<{ name: string; address?: string }> } | null;
  observationTargets?: DateObservation[][];
};

export type DateOrchestrationResult = {
  primaryResult: AIPlannerResult;
  taskResults: LimitedTaskResult[];
  finalResult: AIPlannerResult;
  workingPlan: AIPlannerReply | null;
  observations: DateObservation[];
  executionSummary: DateOrchestrationSummary;
};

/** Planning is read-only. A partial plan remains available to the dispatcher. */
export function prepareDateExecutionPlan(input: { context: DateContext; route: ChatRoute | null;
  visiblePlaces?: Array<AIChatStop | string>; timestamp: string }) {
  return input.context.interpreterMode === "assist" ? observeDateExecutionPlan(input) : null;
}

function summary(request: DateOrchestrationRequest, results: LimitedTaskResult[],
  observations: DateObservation[]): DateOrchestrationSummary {
  const dispatch = observations.findLast(row => row.type === "task_dispatch");
  const plan = request.executionPlan;
  return { primaryRoute: request.legacyRoute?.mode ?? null,
    plannedTaskCount: plan?.tasks.length ?? 0,
    executableTaskCount: plan ? (plan.taskValidation ?? validateDateExecutionStructure(plan))
      .filter(row => row.executable).length : 0,
    executedTaskCount: dispatch?.type === "task_dispatch" ? dispatch.data.executedCount
      : results.filter(row => row.status !== "skipped").length,
    successCount: results.filter(row => row.status === "success").length,
    failedCount: results.filter(row => row.status === "failed").length,
    skippedCount: results.filter(row => row.status === "skipped").length,
    dependencyBlockedCount: results.filter(row => row.failureCode === "dependency_blocked"
      || row.failureCode === "dependency_failed").length };
}

/** Keeps the legacy primary authority while coordinating only allowlisted supplementary tasks. */
export async function orchestrateDateTurn(request: DateOrchestrationRequest,
  dispatch: typeof dispatchLimitedDateTasks = dispatchLimitedDateTasks,
  executors?: LimitedTaskExecutors): Promise<DateOrchestrationResult> {
  const primaryResult = await request.executePrimary();
  const empty = (): DateOrchestrationResult => ({ primaryResult, finalResult: primaryResult,
    taskResults: [], observations: [],
    workingPlan: primaryResult.status === "plan" ? primaryResult : null,
    executionSummary: summary(request, [], []) });
  if (request.executionMode !== "limited" || !request.executionPlan || !request.taskContext)
    return empty();

  let outcome: DateTaskDispatchOutput;
  try {
    const context = request.taskContext(primaryResult);
    outcome = await dispatch(context, executors);
  } catch {
    // Supplementary orchestration must never replace a completed primary response.
    return empty();
  }
  for (const target of request.observationTargets ?? []) target.push(...outcome.observations);
  if (request.session) for (const result of outcome.taskResults) {
    if (result.taskType === "record_feedback" && result.status === "success" && "entries" in result)
      request.session.feedbackEntries.push(...result.entries);
    if (result.taskType === "recommend_places" && result.status === "success" && "card" in result)
      request.session.supplementaryShown.push(...(result.card?.stops ?? []).map(stop => ({
        name: stop.name, ...(stop.address ? { address: stop.address } : {}),
      })));
  }
  return { primaryResult, taskResults: outcome.taskResults, finalResult: outcome.result,
    workingPlan: outcome.workingPlan, observations: outcome.observations,
    executionSummary: summary(request, outcome.taskResults, outcome.observations) };
}
