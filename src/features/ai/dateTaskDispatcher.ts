import type { AIPlannerReply, AIPlannerResult } from "@/features/planning/types/plan";
import { executeLimitedMutation, type DateMutationExecutionResult } from "./dateMutationExecution";
import { executeSupplementaryInspections, appendVenueInspectionResults,
  MAX_INSPECTIONS_PER_TURN, type DateTaskExecutionResult,
  type VenueInspectionTaskExecutionResult } from "./dateVenueInspection";
import { executeLimitedExplanation, appendRecommendationExplanation,
  type ExplanationTaskExecutionResult } from "./dateRecommendationExplanation";
import { executeLimitedPlaceRecommendation, appendPlaceRecommendation,
  type PlaceRecommendationTaskExecutionResult } from "./datePlaceRecommendationExecution";
import { executeLimitedComparison, appendPlaceComparison,
  type PlaceComparisonExecutionResult } from "./datePlaceComparisonExecution";
import { executeLimitedFeedback, type FeedbackTaskExecutionResult } from "./dateFeedbackExecution";
import { mergeSessionFeedback } from "./sessionFeedback";
import { validateDateExecutionStructure, type DateExecutionPlan, type DateExecutionTask,
  type DateExecutionTaskType } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";

type MutationInput = Parameters<typeof executeLimitedMutation>[0];
type InspectionInput = Parameters<typeof executeSupplementaryInspections>[0];
type ExplanationInput = Parameters<typeof executeLimitedExplanation>[0];
type PlaceInput = Parameters<typeof executeLimitedPlaceRecommendation>[0];
type ComparisonInput = Parameters<typeof executeLimitedComparison>[0];
type FeedbackInput = Parameters<typeof executeLimitedFeedback>[0];

/** Explicit limited allowlist. No task can select an executor by name. */
export const LIMITED_TASK_TYPES = ["modify_itinerary", "inspect_venue", "explain_recommendation",
  "recommend_places", "compare_places", "record_feedback"] as const;
export const MAX_LIMITED_TASK_EXECUTIONS = 5; // Preserve the existing per-turn execution ceiling.

export type DispatcherTaskResult = {
  taskId: string; taskType: DateExecutionTaskType; status: "skipped" | "failed";
  source: "limited_task_dispatcher"; coveredByLegacyRoute: false;
  failureCode: "shadow_task" | "task_invalid" | "dependency_blocked"
    | "dependency_failed" | "execution_limit" | "executor_threw";
};
export type LimitedTaskResult = DateTaskExecutionResult | DispatcherTaskResult;

/** The dispatcher owns scheduling; each existing executor still owns its eligibility and coverage checks. */
export type DateTaskExecutor<TInput, TOutput> = { execute(input: TInput): Promise<TOutput> };
export type LimitedTaskExecutors = {
  modify: DateTaskExecutor<MutationInput, Awaited<ReturnType<typeof executeLimitedMutation>>>;
  inspect: DateTaskExecutor<InspectionInput, Awaited<ReturnType<typeof executeSupplementaryInspections>>>;
  explain: DateTaskExecutor<ExplanationInput, Awaited<ReturnType<typeof executeLimitedExplanation>>>;
  recommend: DateTaskExecutor<PlaceInput, Awaited<ReturnType<typeof executeLimitedPlaceRecommendation>>>;
  compare: DateTaskExecutor<ComparisonInput, Awaited<ReturnType<typeof executeLimitedComparison>>>;
  feedback: DateTaskExecutor<FeedbackInput, Awaited<ReturnType<typeof executeLimitedFeedback>>>;
};
const defaultExecutors: LimitedTaskExecutors = {
  modify: { execute: input => executeLimitedMutation(input) },
  inspect: { execute: input => executeSupplementaryInspections(input) },
  explain: { execute: input => executeLimitedExplanation(input) },
  recommend: { execute: input => executeLimitedPlaceRecommendation(input) },
  compare: { execute: input => executeLimitedComparison(input) },
  feedback: { execute: input => executeLimitedFeedback(input) },
};

/** A small execution read model; no AIPlannerState or DateContext is passed to every executor. */
export type DateTaskExecutionContext = {
  plan: DateExecutionPlan;
  primary: AIPlannerResult;
  mutation: Omit<MutationInput, "plan" | "primary">;
  inspection: Omit<InspectionInput, "plan">;
  explanation: Omit<ExplanationInput, "plan" | "primary" | "resultAfterMutation" | "mutationResult">;
  recommendation?: Omit<PlaceInput, "plan" | "task">;
  comparison?: Omit<ComparisonInput, "plan" | "task" | "primary">;
  feedback?: Omit<FeedbackInput, "plan" | "task">;
};

const priority = (task: DateExecutionTask) => task.type === "modify_itinerary" ? 0
  : task.type === "record_feedback" ? 1 : task.type === "inspect_venue" ? 2
    : task.type === "explain_recommendation" ? 3 : task.type === "compare_places" ? 4
      : task.type === "recommend_places" ? 5 : 6;

/** Stable topological order. Plan order leads; the fixed task priority breaks malformed ties. */
export function orderLimitedTasks(tasks: DateExecutionTask[]): DateExecutionTask[] {
  const remaining = new Map(tasks.map(task => [task.id, task]));
  const ordered: DateExecutionTask[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter(task => task.dependencies.every(id => !remaining.has(id)));
    if (!ready.length) return [...ordered, ...remaining.values()]; // Existing plan validator rejects cycles.
    ready.sort((a, b) => a.executionOrder - b.executionOrder || priority(a) - priority(b));
    const next = ready[0];
    ordered.push(next);
    remaining.delete(next.id);
  }
  return ordered;
}

function dispatcherResult(task: DateExecutionTask, status: DispatcherTaskResult["status"],
  failureCode: DispatcherTaskResult["failureCode"]): DispatcherTaskResult {
  return { taskId: task.id, taskType: task.type, status, source: "limited_task_dispatcher",
    coveredByLegacyRoute: false, failureCode };
}

function taskValidation(context: DateTaskExecutionContext, task: DateExecutionTask) {
  // Planned tasks carry state validation from the planner. The dispatcher owns graph
  // checks; each executor rechecks its own current target and capability at runtime.
  return context.plan.taskValidation?.find(row => row.taskId === task.id)
    ?? validateDateExecutionStructure(context.plan).find(row => row.taskId === task.id);
}

/** Preserve the wire contract and existing append order before supplementary places. */
export function mergeTaskExecutionResults(primary: AIPlannerResult, mutationResult: AIPlannerResult | null,
  inspections: VenueInspectionTaskExecutionResult[], explanation: ExplanationTaskExecutionResult | null,
  recommendation: PlaceRecommendationTaskExecutionResult | null = null,
  comparison: PlaceComparisonExecutionResult | null = null,
  displayOrder?: DateExecutionTaskType[]): AIPlannerResult {
  const base = mutationResult ?? primary;
  const appenders = {
    inspect_venue: (result: AIPlannerResult) => appendVenueInspectionResults(result, inspections),
    explain_recommendation: (result: AIPlannerResult) => appendRecommendationExplanation(result, explanation),
    recommend_places: (result: AIPlannerResult) => appendPlaceRecommendation(result, recommendation),
    compare_places: (result: AIPlannerResult) => appendPlaceComparison(result, comparison),
  };
  const fallbackOrder = Object.keys(appenders) as Array<keyof typeof appenders>;
  const ordered = [...new Set([...(displayOrder ?? []).filter((type): type is keyof typeof appenders =>
    type in appenders), ...fallbackOrder])];
  const merged = ordered.reduce((result, type) => appenders[type](result), base);
  if (merged === base) return base;
  // Each append helper contributes the same text to card.lines and message. Suppress only
  // exact repeated facts; similar place names may represent different, useful claims.
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const seen = new Set(base.card.lines.map(normalize));
  const additions = merged.card.lines.slice(base.card.lines.length).filter(line => {
    const key = normalize(line);
    if (!key || seen.has(key) || normalize(base.message).includes(key)) return false;
    seen.add(key); return true;
  });
  if (additions.length === merged.card.lines.length - base.card.lines.length) return merged;
  return { ...merged, message: `${base.message} ${additions.join(" ")}`.trim(),
    card: { ...merged.card, lines: [...base.card.lines, ...additions] } };
}

export type DateTaskDispatchOutput = { result: AIPlannerResult; taskResults: LimitedTaskResult[];
  observations: DateObservation[]; workingPlan: AIPlannerReply | null };

/** Explicit allowlist dispatcher. A failure is recorded on its task and cannot abort independent tasks. */
export async function dispatchLimitedDateTasks(context: DateTaskExecutionContext,
  executors: LimitedTaskExecutors = defaultExecutors): Promise<DateTaskDispatchOutput> {
  const { plan, primary } = context;
  const results: LimitedTaskResult[] = [];
  const observations: DateObservation[] = [];
  let mutationResult: AIPlannerResult | null = null;
  let mutationTaskResult: DateMutationExecutionResult | null = null;
  let inspections: VenueInspectionTaskExecutionResult[] = [];
  let explanation: ExplanationTaskExecutionResult | null = null;
  let recommendation: PlaceRecommendationTaskExecutionResult | null = null;
  let comparison: PlaceComparisonExecutionResult | null = null;
  let feedback: FeedbackTaskExecutionResult | null = null;
  let inspected = false;
  let mutated = false;
  let explained = false;
  let recommended = false;
  let compared = false;
  let recordedFeedback = false;
  let attempted = 0;
  const byId = new Map<string, LimitedTaskResult>();
  for (const task of orderLimitedTasks(plan.tasks)) {
    if (!LIMITED_TASK_TYPES.includes(task.type as typeof LIMITED_TASK_TYPES[number])) {
      const result = dispatcherResult(task, "skipped", "shadow_task");
      results.push(result); byId.set(task.id, result);
      continue;
    }
    const validation = taskValidation(context, task);
    if (!validation?.executable || task.status !== "planned") {
      const result = dispatcherResult(task, "skipped", validation?.blockingIssues
        .some(item => item.code === "dependency_blocked") ? "dependency_blocked" : "task_invalid");
      results.push(result); byId.set(task.id, result);
      continue;
    }
    if (task.type === "inspect_venue" && inspected) continue; // Existing executor batches and deduplicates all inspections.
    if (task.type === "modify_itinerary" && mutated || task.type === "explain_recommendation" && explained
      || task.type === "recommend_places" && recommended || task.type === "compare_places" && compared
      || task.type === "record_feedback" && recordedFeedback) {
      const result = dispatcherResult(task, "skipped", "execution_limit");
      results.push(result); byId.set(task.id, result);
      continue;
    }
    const failedDependency = task.dependencies.some(id => byId.get(id)?.status !== "success");
    if (failedDependency) {
      const result = dispatcherResult(task, "skipped", "dependency_failed");
      results.push(result); byId.set(task.id, result);
      continue;
    }
    if (attempted >= MAX_LIMITED_TASK_EXECUTIONS) {
      const result = dispatcherResult(task, "skipped", "execution_limit");
      results.push(result); byId.set(task.id, result);
      continue;
    }
    try {
      if (task.type === "modify_itinerary") {
        mutated = true; attempted += 1;
        const outcome = await executors.modify.execute({ ...context.mutation, plan, primary });
        mutationResult = outcome.result;
        mutationTaskResult = outcome.taskResult;
        if (outcome.taskResult) { results.push(outcome.taskResult); byId.set(task.id, outcome.taskResult); }
        if (outcome.observation) observations.push(outcome.observation);
      } else if (task.type === "inspect_venue") {
        inspected = true;
        const outcome = await executors.inspect.execute({ ...context.inspection, plan });
        let available = Math.min(MAX_INSPECTIONS_PER_TURN, MAX_LIMITED_TASK_EXECUTIONS - attempted);
        let inspectionAttempts = 0;
        inspections = outcome.results.filter(result => !byId.has(result.taskId)).map(result => {
          if (result.status === "skipped") return result;
          if (available > 0) { available -= 1; inspectionAttempts += 1; return result; }
          return { ...result, status: "skipped" as const, evidenceFound: false,
            data: undefined, failureCode: "limit_reached" as const };
        });
        attempted += inspectionAttempts;
        results.push(...inspections);
        for (const result of inspections) byId.set(result.taskId, result);
        observations.push(...outcome.observations);
      } else if (task.type === "explain_recommendation") {
        explained = true; attempted += 1;
        const resultAfterMutation = appendVenueInspectionResults(mutationResult ?? primary, inspections);
        const outcome = await executors.explain.execute({ ...context.explanation, plan, primary,
          resultAfterMutation, mutationResult: mutationTaskResult });
        explanation = outcome.result;
        if (outcome.result) { results.push(outcome.result); byId.set(task.id, outcome.result); }
        if (outcome.observation) observations.push(outcome.observation);
      } else if (task.type === "recommend_places") {
        recommended = true; attempted += 1;
        if (!context.recommendation) {
          const result = dispatcherResult(task, "skipped", "shadow_task");
          results.push(result); byId.set(task.id, result);
          continue;
        }
        const outcome = await executors.recommend.execute({ ...context.recommendation, plan, task,
          state: mutationResult?.state ?? context.recommendation.state,
          sessionFeedback: mergeSessionFeedback(context.recommendation.sessionFeedback,
            feedback?.status === "success" ? feedback.entries : []) });
        recommendation = outcome.result;
        results.push(outcome.result); byId.set(task.id, outcome.result);
        observations.push(outcome.observation);
      } else if (task.type === "compare_places") {
        compared = true; attempted += 1;
        if (!context.comparison) {
          const result = dispatcherResult(task, "skipped", "shadow_task");
          results.push(result); byId.set(task.id, result); continue;
        }
        const outcome = await executors.compare.execute({ ...context.comparison, plan, task, primary,
          currentPlan: task.dependencies.some(id => plan.tasks.some(row => row.id === id
            && row.type === "modify_itinerary")) && mutationResult?.status === "plan"
            ? mutationResult : context.comparison.currentPlan });
        comparison = outcome.result;
        results.push(outcome.result); byId.set(task.id, outcome.result);
        observations.push(outcome.observation);
      } else if (task.type === "record_feedback") {
        recordedFeedback = true; attempted += 1;
        if (!context.feedback) {
          const result = dispatcherResult(task, "skipped", "shadow_task");
          results.push(result); byId.set(task.id, result); continue;
        }
        const outcome = await executors.feedback.execute({ ...context.feedback, plan, task });
        feedback = outcome.result;
        results.push(outcome.result); byId.set(task.id, outcome.result);
        observations.push(outcome.observation);
      }
    } catch {
      const failedTasks = task.type === "inspect_venue"
        ? plan.tasks.filter(row => row.type === "inspect_venue" && !byId.has(row.id)) : [task];
      for (const failedTask of failedTasks) {
        const result = dispatcherResult(failedTask, "failed", "executor_threw");
        results.push(result); byId.set(failedTask.id, result);
      }
      if (task.type === "modify_itinerary") mutated = true;
      if (task.type === "inspect_venue") inspected = true;
      if (task.type === "explain_recommendation") explained = true;
      if (task.type === "recommend_places") recommended = true;
      if (task.type === "compare_places") compared = true;
      if (task.type === "record_feedback") recordedFeedback = true;
    }
  }
  const result = mergeTaskExecutionResults(primary, mutationResult, inspections, explanation,
    recommendation, comparison, [...plan.tasks].sort((a, b) => a.executionOrder - b.executionOrder)
      .map(task => task.type));
  const executedCount = results.filter(row => row.status !== "skipped"
    && (row.source !== "limited_task_dispatcher" || row.failureCode === "executor_threw")).length;
  const summary: DateObservation = { type: "task_dispatch", source: "limited_task_dispatcher",
    timestamp: new Date().toISOString(), data: {
      plannedCount: plan.tasks.length,
      validTaskCount: plan.tasks.filter(task => taskValidation(context, task)?.valid).length,
      executableTaskCount: plan.tasks.filter(task => taskValidation(context, task)?.executable).length,
      blockedTaskCount: plan.tasks.filter(task => !taskValidation(context, task)?.executable).length,
      dependencyBlockedCount: results.filter(row => row.failureCode === "dependency_blocked"
        || row.failureCode === "dependency_failed").length,
      independentlyExecutedCount: results.filter(row => row.status !== "skipped"
        && !plan.tasks.find(task => task.id === row.taskId)?.dependencies.length).length,
      executableLimitedCount: executedCount,
      executedCount,
      successCount: results.filter(row => row.status === "success").length,
      failedCount: results.filter(row => row.status === "failed").length,
      skippedCount: results.filter(row => row.status === "skipped").length,
      dependencySkipCount: results.filter(row => row.failureCode === "dependency_failed").length,
    } };
  observations.push(summary);
  if (process.env.NODE_ENV === "development") console.info("date_task_dispatch", JSON.stringify({
    ...summary.data,
    tasks: results.map(row => ({ type: row.taskType, status: row.status,
      coveredByLegacyRoute: row.coveredByLegacyRoute, failureCode: row.failureCode ?? null,
      ...(row.taskType === "inspect_venue" && "evidenceFound" in row
        ? { evidenceFound: row.evidenceFound } : {}),
      ...(row.taskType === "explain_recommendation" && "evidenceCount" in row
        ? { evidenceCount: row.evidenceCount } : {}),
    })),
  }));
  return { result, taskResults: results, observations, workingPlan: result.status === "plan" ? result : null };
}
