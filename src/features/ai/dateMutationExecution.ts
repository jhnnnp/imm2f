import type { AIChatStop, AIPlannerReply, AIPlannerResult, AIPlannerState } from "@/features/planning/types/plan";
import type { FootRoute } from "@/lib/routing/footRoute";
import { fetchFootRoute } from "@/lib/routing/footRoute";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import type { ChatRoute } from "./chatRoute";
import { courseMutationProblems } from "./courseMutation";
import { candidateFoodConflict } from "./dateIntent";
import { validateDateExecutionTask, type DateExecutionPlan, type DateExecutionTarget } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";
import type { SessionCandidateContext } from "./sessionCandidates";
import type { DateTurnUnderstanding, DateRequestedChange } from "./dateTurnUnderstanding";
import { routeLegsFitSchedule } from "./dateVerifier";
import { editCurrentCourse } from "./editCurrentCourse";
import { clockMinutes } from "./schedule";
import type { DateExecutionMode } from "./dateVenueInspection";

type Operation = Exclude<DateRequestedChange["operation"], "add">;
type VerifiedItem = { itemId: string; venueId: string; name: string; index: number; slot: string | null };
export type VerifiedMutationRequest = { taskId: string; operation: Operation; target: VerifiedItem;
  reorderWith?: VerifiedItem; explicitTime?: string;
  replacementPreference?: { dimension: string; value: string };
  source: "deterministic" | "llm" | "legacy_route" | "legacy_heuristic" | "existing_state"
    | "conversation_reference" | "unknown"; confidence: number };
export type MutationTransaction = { basePlaceIds: string[]; operations: VerifiedMutationRequest[];
  protectedItemIds: string[]; expectedPlaceIds: string[] };
export type MutationCoverageDecision = { coveredByLegacyRoute: boolean; shouldExecuteLimitedMutation: boolean;
  reason: "covered" | "needs_deterministic_edit" | "legacy_replace_failed" | "unsupported_primary_route" };
export type DateMutationExecutionResult = { taskId: string; taskType: "modify_itinerary";
  source: "existing_mutation_engine";
  operation: Operation; status: "success" | "skipped" | "failed";
  changedItemIds: string[]; preservedItemIds: string[]; coveredByLegacyRoute: boolean;
  verifiedTarget: boolean; verificationPassed: boolean;
  failureCode?: "mode_disabled" | "interpreter_disabled" | "invalid_plan" | "not_planned"
    | "missing_change" | "unsupported_operation" | "unverified_target" | "low_confidence"
    | "unsupported_condition" | "unmet_dependency" | "unresolved_reference" | "multi_day"
    | "ambiguous_change" | "missing_deterministic_time" | "unsupported_primary_route"
    | "replacement_unavailable" | "mutation_verification_failed" | "schedule_failed"
    | "route_failed" | "target_disappeared" | "engine_failed";
  verificationSummary?: { mutationProblems: number; hardProblems: number; routeVerified: boolean } };

const MIN_MUTATION_CONFIDENCE = 0.75;
const timePattern = /(?:(오전|오후|저녁|밤)\s*)?(\d{1,2})(?::([0-5]\d)|시(?:\s*([0-5]?\d)분)?)\s*(?:으로|로|에)\s*(?:미뤄|늦춰|옮겨|바꿔|변경)/;
const clock = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? clockMinutes(value) : null;

/** Only the current utterance can supply a clock time; LLM explicitValue is ignored. */
export function deterministicMutationTime(message: string, slot: string | null): string | null {
  const match = message.match(timePattern);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] ?? match[4] ?? 0);
  if (hour > 23 || minute > 59) return null;
  if (hour <= 12 && /오후|저녁|밤/.test(match[1] ?? "")) hour = hour === 12 ? 12 : hour + 12;
  else if (hour === 12 && match[1] === "오전") hour = 0;
  else if (!match[1] && hour < 12 && slot === "meal" && /저녁/.test(message)) hour += 12;
  else if (!match[1] && hour < 12) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function operationGrounded(operation: Operation, message: string) {
  if (operation === "remove") return /빼|제외|삭제/.test(message);
  if (operation === "reorder") return /순서|앞뒤|자리/.test(message) && /바꿔|교체|뒤집|옮겨/.test(message);
  if (operation === "retime") return /미뤄|늦춰|시간.*(?:바꿔|변경|옮겨)/.test(message);
  if (operation === "keep") return /그대로|유지|남겨/.test(message);
  return /바꿔|교체|다른\s*(?:곳|데)|대신/.test(message);
}

function resolveItem(target: DateExecutionTarget | undefined, plan: AIPlannerReply): VerifiedItem | null {
  if (target?.kind !== "plan_item" || !target.placeId) return null;
  const matches = plan.items.map((item, index) => ({ item, index })).filter(({ item }) =>
    item.placeId === target.placeId && item.placeName === target.name);
  if (matches.length !== 1) return null;
  const { item, index } = matches[0];
  const recommendation = plan.recommendations.filter(place => place.placeId === item.placeId && place.name === item.placeName);
  if (recommendation.length !== 1) return null;
  return { itemId: item.id, venueId: item.placeId, name: item.placeName, index,
    slot: recommendation[0].activitySlot ?? null };
}

type Input = { plan: DateExecutionPlan | null; currentPlan: AIPlannerReply | null;
  primary: AIPlannerResult; route: ChatRoute | null; interpreterMode: DateTurnInterpreterMode;
  executionMode: DateExecutionMode; userMessage: string; state: AIPlannerState;
  understanding?: DateTurnUnderstanding | null; visiblePlaces?: AIChatStop[];
  sessionCandidates?: SessionCandidateContext | null };
type Built = { transaction: MutationTransaction; taskId: string } | { failureCode: NonNullable<DateMutationExecutionResult["failureCode"]>;
  taskId: string; operation: Operation };

/** Fail closed before any mutation function sees a task or an LLM-proposed ID. */
export function buildVerifiedMutationTransaction(input: Omit<Input, "primary" | "route">): Built | null {
  const task = input.plan?.tasks.find(row => row.type === "modify_itinerary");
  if (!task) return null;
  const operation = task.changes?.find(change => change.operation !== "add")?.operation as Operation | undefined ?? "keep";
  const fail = (failureCode: NonNullable<DateMutationExecutionResult["failureCode"]>): Built => ({
    failureCode, taskId: task.id, operation });
  if (input.executionMode !== "limited") return fail("mode_disabled");
  if (input.interpreterMode !== "assist") return fail("interpreter_disabled");
  if (!input.currentPlan) return fail("unverified_target");
  if (task.status !== "planned") return fail("not_planned");
  if (task.condition) return fail("unsupported_condition");
  if (task.dependencies.length) return fail("unmet_dependency");
  if (!input.plan || !validateDateExecutionTask(input.plan, task.id, input.currentPlan,
    input.visiblePlaces ?? [], input.sessionCandidates)?.executable) return fail("invalid_plan");
  if (task.confidence < MIN_MUTATION_CONFIDENCE) return fail("low_confidence");
  if (!task.changes?.length) return fail("missing_change");
  if (task.changes.some(change => change.operation === "add")) return fail("unsupported_operation");
  if (input.currentPlan.items.length !== input.currentPlan.recommendations.length
    || input.currentPlan.items.some((item, index) => item.placeId !== input.currentPlan!.recommendations[index]?.placeId
      || item.placeName !== input.currentPlan!.recommendations[index]?.name)) return fail("unverified_target");
  if (new Set(input.currentPlan.items.map(item => item.dayIndex)).size !== 1
    || input.currentPlan.items.some(item => item.dayIndex !== 0)) return fail("multi_day");
  // An unrelated explanation may refer to a venue created by this mutation.
  // Only the mutation's own target must be resolved before execution.
  if (task.changes.some(change => !change.target)) return fail("unresolved_reference");
  const actionable = task.changes.filter(change => change.operation !== "keep");
  if (actionable.length > 1) return fail("ambiguous_change");
  const operations: VerifiedMutationRequest[] = [];
  for (const change of task.changes) {
    const op = change.operation as Operation;
    if ((change.confidence ?? 0) < MIN_MUTATION_CONFIDENCE) return fail("low_confidence");
    if (!operationGrounded(op, input.userMessage)) return fail("unsupported_operation");
    const target = resolveItem(change.target, input.currentPlan);
    if (!target) return fail("unverified_target");
    const reorderWith = op === "reorder" ? resolveItem(task.targets?.find(item => item.placeId !== target.venueId), input.currentPlan) : null;
    if (op === "reorder" && (!reorderWith || task.targets?.length !== 2
      || !task.targets.some(item => item.placeId === target.venueId && item.name === target.name)))
      return fail("unverified_target");
    const explicitTime = op === "retime" ? deterministicMutationTime(input.userMessage, target.slot) : null;
    if (op === "retime" && !explicitTime) return fail("missing_deterministic_time");
    if (op === "replace" && !["meal", "cafe"].includes(target.slot ?? "")) return fail("unsupported_operation");
    operations.push({ taskId: task.id, operation: op, target,
      ...(reorderWith ? { reorderWith } : {}), ...(explicitTime ? { explicitTime } : {}),
      ...(change.replacementPreference ? { replacementPreference: change.replacementPreference } : {}),
      source: task.source, confidence: Math.min(task.confidence, change.confidence ?? 0) });
  }
  const protectedItemIds = operations.filter(row => row.operation === "keep").map(row => row.target.itemId);
  const basePlaceIds = input.currentPlan.items.map(item => item.placeId);
  const expectedPlaceIds = [...basePlaceIds];
  const mutation = operations.find(row => row.operation !== "keep");
  if (mutation?.operation === "remove") expectedPlaceIds.splice(mutation.target.index, 1);
  if (mutation?.operation === "reorder" && mutation.reorderWith) {
    [expectedPlaceIds[mutation.target.index], expectedPlaceIds[mutation.reorderWith.index]] =
      [expectedPlaceIds[mutation.reorderWith.index], expectedPlaceIds[mutation.target.index]];
  }
  if (protectedItemIds.some(id => mutation?.target.itemId === id && mutation.operation !== "reorder"))
    return fail("ambiguous_change");
  return { transaction: { basePlaceIds, operations, protectedItemIds, expectedPlaceIds }, taskId: task.id };
}

function protectedPreserved(transaction: MutationTransaction, before: AIPlannerReply, after: AIPlannerReply) {
  return transaction.protectedItemIds.every(id => {
    const old = before.items.find(item => item.id === id);
    return old && after.items.some(item => item.placeId === old.placeId && item.id === old.id);
  });
}

/** Compare the actual result at operation/target granularity, never route name alone. */
export function mutationCoverage(transaction: MutationTransaction, route: ChatRoute | null,
  before: AIPlannerReply, primary: AIPlannerResult): MutationCoverageDecision {
  const mutation = transaction.operations.find(row => row.operation !== "keep");
  if (!mutation) return { coveredByLegacyRoute: true, shouldExecuteLimitedMutation: false, reason: "covered" };
  if (route?.mode === "places" || route?.mode === "chat" || !route)
    return { coveredByLegacyRoute: false, shouldExecuteLimitedMutation: false, reason: "unsupported_primary_route" };
  if (primary.status === "plan" && protectedPreserved(transaction, before, primary)) {
    const ids = primary.items.map(item => item.placeId);
    const covered = mutation.operation === "remove" ? ids.join("|") === transaction.expectedPlaceIds.join("|")
      : mutation.operation === "reorder" ? ids.join("|") === transaction.expectedPlaceIds.join("|")
        : mutation.operation === "retime" ? ids.join("|") === transaction.basePlaceIds.join("|")
          && primary.items.some(item => item.placeId === mutation.target.venueId && item.startTime === mutation.explicitTime)
          : !ids.includes(mutation.target.venueId) && ids.length === before.items.length
            && before.recommendations.some(place => place.placeId === mutation.target.venueId)
            && primary.recommendations.some(place => !transaction.basePlaceIds.includes(place.placeId)
              && place.activitySlot === mutation.target.slot);
    if (covered) return { coveredByLegacyRoute: true, shouldExecuteLimitedMutation: false, reason: "covered" };
  }
  if (mutation.operation === "replace") return { coveredByLegacyRoute: false,
    shouldExecuteLimitedMutation: false, reason: "legacy_replace_failed" };
  return { coveredByLegacyRoute: false, shouldExecuteLimitedMutation: true, reason: "needs_deterministic_edit" };
}

async function verifyMutation(input: Input, transaction: MutationTransaction, candidate: AIPlannerReply,
  fetchRoute: typeof fetchFootRoute, knownRoute?: FootRoute | null): Promise<{ passed: boolean; code?: DateMutationExecutionResult["failureCode"];
    summary: NonNullable<DateMutationExecutionResult["verificationSummary"]> }> {
  const previous = input.currentPlan!;
  const mutation = transaction.operations.find(row => row.operation !== "keep");
  const originalExclusions = previous.state.excludedPlaces ?? [];
  const removedName = mutation?.operation === "remove" || mutation?.operation === "replace" ? mutation.target.name : null;
  const validationState: AIPlannerState = { ...candidate.state, preserveExistingPlaces: true,
    intent: mutation?.operation === "remove" ? "remove" : "modify",
    excludedPlaces: [...new Set([...originalExclusions, ...(removedName ? [removedName] : [])])] };
  const mutationProblems = courseMutationProblems(previous, candidate, validationState,
    mutation?.operation === "reorder" ? { expectedOrderIds: transaction.expectedPlaceIds } : {});
  const hardProblems: string[] = [];
  if (!protectedPreserved(transaction, previous, candidate)) hardProblems.push("protected_item_changed");
  if (mutation?.operation !== "replace" && candidate.items.map(item => item.placeId).join("|") !== transaction.expectedPlaceIds.join("|"))
    hardProblems.push("unexpected_items");
  if (mutation?.operation === "replace" && (candidate.items.length !== previous.items.length
    || candidate.items.some((item, index) => index === mutation.target.index
      ? item.placeId === mutation.target.venueId || candidate.recommendations[index]?.activitySlot !== mutation.target.slot
      : item.placeId !== previous.items[index]?.placeId))) hardProblems.push("replacement_slot_changed");
  const hard = input.understanding?.explicitConstraints;
  const required = [...new Set([...(previous.state.requiredPlaces ?? []), ...(hard?.requiredPlaces ?? [])])];
  if (required.some(name => !candidate.recommendations.some(place => place.name === name))) hardProblems.push("required_place_missing");
  const excluded = [...new Set([...originalExclusions, ...(hard?.excludedPlaces ?? [])])];
  if (excluded.some(name => candidate.recommendations.some(place => place.name === name))) hardProblems.push("excluded_place_present");
  const excludedFoods = [...new Set([...(previous.state.excludedFoods ?? []), ...(hard?.excludedFoods ?? [])])];
  if (candidate.recommendations.some(place => candidateFoodConflict(`${place.name} ${place.category} ${place.dishes ?? ""}`, excludedFoods)))
    hardProblems.push("excluded_food_present");
  const budget = hard?.budgetWon ?? input.state.budgetWon ?? previous.condition.budget;
  if (budget != null && candidate.items.reduce((sum, item) => sum + item.expectedCost, 0) > budget)
    hardProblems.push("over_budget");
  if (candidate.condition.dateLabel !== (hard?.date ?? previous.condition.dateLabel)
    || candidate.condition.region !== previous.condition.region) hardProblems.push("date_or_area_changed");
  if (candidate.condition.startTime !== previous.condition.startTime
    || candidate.condition.endTime !== previous.condition.endTime
    || (hard?.startTime && hard.startTime !== previous.condition.startTime)
    || (hard?.endTime && hard.endTime !== previous.condition.endTime)
    || (hard?.areas?.length && !hard.areas.includes(previous.condition.region)))
    hardProblems.push("time_or_area_constraint_changed");
  if (hard?.requiredActivities?.some(activity => !candidate.recommendations.some(place =>
    place.activitySlot === activity))) hardProblems.push("required_activity_missing");
  if (candidate.items.length !== candidate.recommendations.length || !candidate.items.length
    || candidate.items.some(item => item.dayIndex !== 0)) hardProblems.push("invalid_structure");
  const start = clock(candidate.condition.startTime);
  const end = clock(candidate.condition.endTime);
  if (start == null || end == null || end <= start || candidate.items.some(item => {
    const at = clock(item.startTime);
    return at == null || at < start || at + item.durationMinutes > end;
  })) return { passed: false, code: "schedule_failed",
    summary: { mutationProblems: mutationProblems.length, hardProblems: hardProblems.length, routeVerified: false } };
  if (mutationProblems.length || hardProblems.length) return { passed: false, code: "mutation_verification_failed",
    summary: { mutationProblems: mutationProblems.length, hardProblems: hardProblems.length, routeVerified: false } };
  let routeVerified = false;
  if (candidate.recommendations.length > 1) {
    const coordinates = candidate.recommendations.map(place => place.coordinates);
    if (coordinates.some(value => !value)) return { passed: false, code: "route_failed",
      summary: { mutationProblems: 0, hardProblems: 0, routeVerified: false } };
    const route: FootRoute | null = knownRoute ?? await fetchRoute(coordinates as [number, number][]);
    if (!route || route.legs.length !== candidate.items.length - 1) return { passed: false, code: "route_failed",
      summary: { mutationProblems: 0, hardProblems: 0, routeVerified: false } };
    const limit = input.state.walkingPreference === "short" ? 1100 : 3000;
    const dailyLimit = input.state.walkingPreference === "short" ? 2500 : 6500;
    const rows = candidate.items.map(item => ({ day_index: item.dayIndex, start_time: item.startTime,
      duration_minutes: item.durationMinutes }));
    if (route.legs.some(leg => leg.meters > limit) || route.meters > dailyLimit
      || !routeLegsFitSchedule(rows, route.legs)) return { passed: false, code: "route_failed",
      summary: { mutationProblems: 0, hardProblems: 0, routeVerified: true } };
    routeVerified = true;
  }
  return { passed: true, summary: { mutationProblems: 0, hardProblems: 0, routeVerified } };
}

function observation(result: DateMutationExecutionResult): DateObservation {
  return { type: "task_execution", source: "date_mutation_execution", timestamp: new Date().toISOString(),
    data: { taskType: "modify_itinerary", operation: result.operation, status: result.status,
      coveredByLegacyRoute: result.coveredByLegacyRoute, verifiedTarget: result.verifiedTarget,
      verificationPassed: result.verificationPassed, failureCode: result.failureCode ?? null } };
}

function rollbackResult(input: Input): AIPlannerResult {
  if (input.primary.status !== "plan" || !input.currentPlan) return input.primary;
  const message = "요청한 변경을 안전하게 검증하지 못해 기존 코스를 유지했어요.";
  return { ...input.currentPlan, message, card: { ...input.currentPlan.card, lines: [message] } };
}

/** The only new dispatcher is this explicit allowlisted mutation executor. */
export async function executeLimitedMutation(input: Input,
  fetchRoute: typeof fetchFootRoute = fetchFootRoute): Promise<{ result: AIPlannerResult;
    taskResult: DateMutationExecutionResult | null; observation: DateObservation | null }> {
  const built = buildVerifiedMutationTransaction(input);
  if (!built) return { result: input.primary, taskResult: null, observation: null };
  const taskId = built.taskId;
  const operation = "transaction" in built
    ? built.transaction.operations.find(row => row.operation !== "keep")?.operation ?? "keep" : built.operation;
  const base = { taskId, taskType: "modify_itinerary" as const,
    source: "existing_mutation_engine" as const, operation,
    changedItemIds: [] as string[], preservedItemIds: [] as string[], coveredByLegacyRoute: false,
    verifiedTarget: "transaction" in built, verificationPassed: false };
  const finish = (result: AIPlannerResult, taskResult: DateMutationExecutionResult) => ({ result, taskResult,
    observation: observation(taskResult) });
  if ("failureCode" in built) return finish(input.primary, { ...base, status: "skipped", failureCode: built.failureCode });
  const transaction = built.transaction;
  const mutation = transaction.operations.find(row => row.operation !== "keep");
  const preservedItemIds = transaction.protectedItemIds;
  if (!mutation) {
    if (input.primary.status === "plan" && !protectedPreserved(transaction, input.currentPlan!, input.primary))
      return finish(rollbackResult(input), { ...base, status: "failed", preservedItemIds,
        failureCode: "mutation_verification_failed" });
    return finish(input.primary, { ...base, status: "success", coveredByLegacyRoute: true,
      preservedItemIds, verificationPassed: true, verificationSummary: { mutationProblems: 0,
        hardProblems: 0, routeVerified: false } });
  }
  const coverage = mutationCoverage(transaction, input.route, input.currentPlan!, input.primary);
  if (coverage.reason === "unsupported_primary_route") return finish(input.primary, { ...base,
    status: "skipped", preservedItemIds, failureCode: "unsupported_primary_route" });
  if (coverage.reason === "legacy_replace_failed") return finish(rollbackResult(input), { ...base,
    status: "failed", preservedItemIds, failureCode: "replacement_unavailable" });
  let candidate: AIPlannerReply;
  let knownRoute: FootRoute | null = null;
  if (coverage.coveredByLegacyRoute) candidate = input.primary as AIPlannerReply;
  else {
    const before = input.currentPlan!;
    const ordered = transaction.expectedPlaceIds.map(id => before.recommendations.find(place => place.placeId === id));
    if (ordered.some(place => !place?.coordinates)) return finish(rollbackResult(input), { ...base,
      status: "failed", preservedItemIds, failureCode: "route_failed" });
    if (ordered.length > 1) {
      try { knownRoute = await fetchRoute(ordered.map(place => place!.coordinates!)); }
      catch { knownRoute = null; }
      if (!knownRoute || knownRoute.legs.length !== ordered.length - 1) return finish(rollbackResult(input), {
        ...base, status: "failed", preservedItemIds, failureCode: "route_failed" });
    }
    const indices = mutation.operation === "remove" ? [mutation.target.index + 1]
      : mutation.operation === "reorder" && mutation.reorderWith ? (() => {
        const order = before.items.map((_, index) => index + 1);
        [order[mutation.target.index], order[mutation.reorderWith.index]] =
          [order[mutation.reorderWith.index], order[mutation.target.index]];
        return order;
      })() : [];
    const kind = mutation.operation === "remove" ? "remove" : mutation.operation === "reorder" ? "reorder" : "retime";
    const proposed = editCurrentCourse(before, { kind, indices }, { ...input.state,
      dateLabel: before.condition.dateLabel, startTime: before.condition.startTime,
      endTime: before.condition.endTime, budgetWon: before.condition.budget,
      excludedPlaces: [...before.state.excludedPlaces],
      requiredPlaces: [...before.state.requiredPlaces] }, {
      ...(mutation.operation === "retime" && mutation.explicitTime
        ? { targetItemId: mutation.target.itemId, targetStartTime: mutation.explicitTime } : {}),
      ...(knownRoute ? { verifiedTravelMinutes: knownRoute.legs.map(leg => Math.ceil(leg.seconds / 60)) } : {}),
    });
    if (proposed.status !== "plan") return finish(rollbackResult(input), { ...base, status: "failed",
      preservedItemIds, failureCode: "schedule_failed" });
    candidate = proposed;
  }
  try {
    const verification = await verifyMutation(input, transaction, candidate, fetchRoute, knownRoute);
    if (!verification.passed) return finish(rollbackResult(input), { ...base, status: "failed",
      preservedItemIds, coveredByLegacyRoute: coverage.coveredByLegacyRoute,
      failureCode: verification.code ?? "mutation_verification_failed", verificationSummary: verification.summary });
    const changedItemIds = mutation.operation === "replace"
      ? [mutation.target.itemId, ...candidate.items.filter(item => !transaction.basePlaceIds.includes(item.placeId)).map(item => item.id)]
      : mutation.operation === "reorder" && mutation.reorderWith
        ? [mutation.target.itemId, mutation.reorderWith.itemId] : [mutation.target.itemId];
    // The legacy search may temporarily exclude the old venue to find a replacement.
    // That operational exclusion must not become a persistent hard preference.
    if (mutation.operation === "replace" && !input.currentPlan!.state.excludedPlaces.includes(mutation.target.name)
      && !input.understanding?.explicitConstraints.excludedPlaces?.includes(mutation.target.name)) {
      candidate = { ...candidate, state: { ...candidate.state,
        excludedPlaces: candidate.state.excludedPlaces.filter(name => name !== mutation.target.name) } };
    }
    if (!coverage.coveredByLegacyRoute && input.route?.mode === "question" && input.primary.status === "chat") {
      candidate = { ...candidate, message: `${candidate.message} ${input.primary.message}`.trim(),
        card: { ...candidate.card, lines: [...candidate.card.lines, ...input.primary.card.lines],
          sources: [...(candidate.card.sources ?? []), ...(input.primary.card.sources ?? [])] } };
    }
    return finish(candidate, { ...base, status: "success", changedItemIds, preservedItemIds,
      coveredByLegacyRoute: coverage.coveredByLegacyRoute, verificationPassed: true,
      verificationSummary: verification.summary });
  } catch {
    return finish(rollbackResult(input), { ...base, status: "failed", preservedItemIds, failureCode: "engine_failed" });
  }
}
