import type { AIChatStop, AIPlannerReply } from "@/features/planning/types/plan";
import type { ChatRoute } from "./chatRoute";
import type { DateContext } from "./dateContext";
import type { DateObservation } from "./dateObservation";
import type { SessionCandidateContext } from "./sessionCandidates";
import type { DateFeedback, DateGoal, DateGoalType, DateProvenanceSource, DateReference,
  DateRequestedChange, DateTurnUnderstanding } from "./dateTurnUnderstanding";

export type DateExecutionTaskType = "create_itinerary" | "modify_itinerary" | "recommend_places"
  | "inspect_venue" | "compare_places" | "explain_recommendation" | "save_itinerary"
  | "record_feedback" | "respond_chat";
export type DateExecutionTarget = { kind: "plan_item" | "place" | "plan"; name: string; placeId?: string };
export type DateExecutionCondition = { kind: "unsupported_predicate"; afterTaskId: string;
  attribute?: string; expected: "unavailable" };
export type DateExecutionIssueCode = "duplicate_task_id" | "missing_dependency" | "dependency_cycle"
  | "missing_target" | "unverified_reference" | "missing_current_plan"
  | "unsupported_condition" | "inconsistent_order" | "dependency_blocked";
export type DateExecutionIssue = { code: DateExecutionIssueCode; taskId?: string };
export type TaskValidationResult = { taskId: string; valid: boolean; executable: boolean;
  blockingIssues: DateExecutionIssue[]; warnings: DateExecutionIssue[] };
export type DateExecutionPlanStatus = "executable" | "partially_executable" | "blocked";
export type DateExecutionTask = {
  id: string;
  type: DateExecutionTaskType;
  goal: DateGoalType;
  target?: DateExecutionTarget;
  targets?: DateExecutionTarget[];
  changes?: Array<{ operation: DateRequestedChange["operation"]; target?: DateExecutionTarget;
    confidence?: number;
    replacementPreference?: { dimension: string; value: string }; explicitValue?: string | number }>;
  feedback?: Array<{ attribute?: string; sentiment: DateFeedback["sentiment"];
    strength?: number; confidence?: number; target?: DateExecutionTarget }>;
  question?: { attribute?: string };
  referenceRequested?: boolean;
  /** Resolved only after a verified replacement succeeds; never an LLM venue ID. */
  deferredTarget?: { kind: "mutation_output"; sourceTaskId: string };
  condition?: DateExecutionCondition;
  dependencies: string[];
  executionOrder: number;
  confidence: number;
  status: "planned" | "blocked" | "unresolved";
  source: DateProvenanceSource;
};
export type DateExecutionPlan = {
  tasks: DateExecutionTask[];
  unresolved: DateExecutionIssue[];
  /** True when at least one task is executable; limited gates still authorize task types. */
  executable: boolean;
  status?: DateExecutionPlanStatus;
  taskValidation?: TaskValidationResult[];
  source: "shadow_understanding" | "effective_understanding";
};
export type ExecutionPlanComparison = {
  legacyRoute: ChatRoute["mode"] | null;
  plannedTaskTypes: DateExecutionTaskType[];
  routeCoverage: "full" | "partial" | "none";
  coveredTasks: DateExecutionTaskType[];
  additionalTasks: DateExecutionTaskType[];
  conflictingTasks: DateExecutionTaskType[];
  blockedTasks: DateExecutionTaskType[];
};

const goalTask: Record<DateGoalType, DateExecutionTaskType> = {
  create_itinerary: "create_itinerary", modify_itinerary: "modify_itinerary",
  recommend_places: "recommend_places", ask_venue: "inspect_venue",
  compare_places: "compare_places", explain_recommendation: "explain_recommendation",
  save_itinerary: "save_itinerary", provide_feedback: "record_feedback", general_chat: "respond_chat",
};
const compact = (text: string) => text.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const same = (a: string, b: string) => compact(a) === compact(b);
type Place = { name: string; placeId?: string; activitySlot?: string; category?: string };

/** Recheck references against application state. Proposed IDs and names are never copied blindly. */
export function verifiedExecutionTarget(reference: DateReference | undefined,
  currentPlan: AIPlannerReply | null, visiblePlaces: Array<AIChatStop | string> = []): DateExecutionTarget | null {
  if (!reference || reference.kind === "unresolved" || reference.kind === "previous_place") return null;
  const ordered: Place[] = currentPlan?.items.length
    ? [...currentPlan.items].sort((a, b) => a.dayIndex - b.dayIndex || a.order - b.order)
      .map(item => currentPlan.recommendations.find(place => place.placeId === item.placeId)
        ?? { name: item.placeName, placeId: item.placeId, category: item.category })
    : currentPlan?.recommendations ?? [];
  const visible: Place[] = visiblePlaces.map(place => typeof place === "string" ? { name: place } : { name: place.name });
  if (reference.kind === "ordinal_place") {
    // The displayed plan and a separate visible list make an ordinal ambiguous.
    if (ordered.length && visible.length) return null;
    const match = reference.text.match(/\d+/)?.[0];
    const ordinal = match ? Number(match) : /첫/.test(reference.text) ? 1
      : /두/.test(reference.text) ? 2 : /세/.test(reference.text) ? 3 : 0;
    const place = (ordered.length ? ordered : visible)[ordinal - 1];
    return place ? { kind: ordered.length ? "plan_item" : "place", name: place.name,
      ...(place.placeId ? { placeId: place.placeId } : {}) } : null;
  }
  if (reference.kind === "category_slot") {
    const slot = /카페/.test(reference.text) ? "cafe" : /저녁|점심|아침|식당/.test(reference.text) ? "meal" : null;
    if (!slot) return null;
    const matches = ordered.filter(place => place.activitySlot === slot || (!place.activitySlot
      && (slot === "cafe" ? /카페/ : /식당|음식|맛집/).test(place.category ?? "")));
    return matches.length === 1 ? { kind: "plan_item", name: matches[0].name,
      ...(matches[0].placeId ? { placeId: matches[0].placeId } : {}) } : null;
  }
  if (reference.targetType === "plan") {
    return currentPlan && reference.resolvedName === currentPlan.card.headline
      ? { kind: "plan", name: currentPlan.card.headline } : null;
  }
  const planMatches = ordered.filter(place => reference.resolvedId
    ? place.placeId === reference.resolvedId && place.name === reference.resolvedName
    : reference.resolvedName && same(place.name, reference.resolvedName));
  if (planMatches.length === 1) return { kind: "plan_item", name: planMatches[0].name,
    ...(planMatches[0].placeId ? { placeId: planMatches[0].placeId } : {}) };
  const visibleMatches = visible.filter(place => reference.resolvedName && same(place.name, reference.resolvedName));
  if (!planMatches.length && visibleMatches.length === 1 && !reference.resolvedId)
    return { kind: "place", name: visibleMatches[0].name };
  return null;
}

function sourceFor(goal: DateGoalType, understanding: DateTurnUnderstanding): DateProvenanceSource {
  const entries = understanding.provenance.filter(item => item.field === "goals" && item.key === goal);
  return entries.find(item => item.source === "llm")?.source ?? entries[0]?.source ?? "unknown";
}

function likelyReference(goal: DateGoal, understanding: DateTurnUnderstanding): DateReference | undefined {
  if (goal.type === "explain_recommendation") {
    if (goal.target?.resolvedName) return goal.target;
    const historical = understanding.references.filter(reference => reference.kind === "previous_place"
      && reference.resolvedId && reference.resolvedName);
    return historical.length === 1 ? historical[0] : goal.target;
  }
  if (goal.target) return goal.target;
  const changes = understanding.requestedChanges;
  if (goal.type === "modify_itinerary") return changes.find(change => change.target)?.target
    ?? (understanding.references.length === 1 ? understanding.references[0] : undefined);
  if (["ask_venue", "compare_places", "provide_feedback"].includes(goal.type))
    return understanding.references.length === 1 ? understanding.references[0] : undefined;
  return undefined;
}

function needsChangeTarget(operation: DateRequestedChange["operation"]) {
  return operation === "remove" || operation === "replace" || operation === "reorder" || operation === "keep";
}

function issue(code: DateExecutionIssueCode, taskId?: string): DateExecutionIssue {
  return { code, ...(taskId ? { taskId } : {}) };
}

/** Structural and state validation. It does not execute or repair any task. */
function targetExists(target: DateExecutionTarget, currentPlan: AIPlannerReply | null,
  visiblePlaces: Array<AIChatStop | string>, taskType: DateExecutionTaskType,
  sessionCandidates?: SessionCandidateContext | null): boolean {
  if (target.kind === "plan") return Boolean(currentPlan && target.name === currentPlan.card.headline);
  if (target.kind === "plan_item") return Boolean(currentPlan?.recommendations.some(place =>
    place.placeId === target.placeId && place.name === target.name)
    || currentPlan?.items.some(item => item.placeId === target.placeId && item.placeName === target.name));
  if (["explain_recommendation", "compare_places", "record_feedback"].includes(taskType)
    && target.kind === "place" && target.placeId && sessionCandidates)
    return sessionCandidates.records.some(row => row.candidateId === target.placeId
      && row.name === target.name && (row.shownCount > 0 || row.currentState === "selected"
        || row.rejectedReasons.length > 0));
  return !target.placeId && visiblePlaces.filter(place =>
    (typeof place === "string" ? place : place.name) === target.name).length === 1;
}

/** Plan structure is checked without venue facts or a current-plan snapshot. */
function structuralIssues(plan: DateExecutionPlan): DateExecutionIssue[] {
  const issues: DateExecutionIssue[] = [];
  const counts = new Map<string, number>();
  for (const task of plan.tasks) counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
  for (const [id, count] of counts) if (count > 1) issues.push(issue("duplicate_task_id", id));
  const byId = new Map(plan.tasks.map(task => [task.id, task]));
  const orderCounts = new Map<number, number>();
  for (const task of plan.tasks) orderCounts.set(task.executionOrder,
    (orderCounts.get(task.executionOrder) ?? 0) + 1);
  for (const task of plan.tasks) {
    if ((orderCounts.get(task.executionOrder) ?? 0) > 1 || !Number.isInteger(task.executionOrder)
      || task.executionOrder < 1 || task.executionOrder > plan.tasks.length)
      issues.push(issue("inconsistent_order", task.id));
    for (const dependency of task.dependencies) {
      const prior = byId.get(dependency);
      if (!prior) issues.push(issue("missing_dependency", task.id));
      else if (prior.executionOrder >= task.executionOrder) issues.push(issue("inconsistent_order", task.id));
    }
    if (task.deferredTarget && (task.type !== "explain_recommendation"
      || !task.dependencies.includes(task.deferredTarget.sourceTaskId)
      || byId.get(task.deferredTarget.sourceTaskId)?.type !== "modify_itinerary"
      || !byId.get(task.deferredTarget.sourceTaskId)?.changes?.some(change => change.operation === "replace")))
      issues.push(issue("missing_dependency", task.id));
    if (task.condition && !task.dependencies.includes(task.condition.afterTaskId))
      issues.push(issue("missing_dependency", task.id));
  }
  const visiting = new Map<string, number>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycleIds = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) {
      for (const member of stack.slice(visiting.get(id))) cycleIds.add(member);
      return;
    }
    if (visited.has(id)) return;
    visiting.set(id, stack.length);
    stack.push(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (byId.has(dependency)) walk(dependency);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of plan.tasks) walk(task.id);
  for (const id of cycleIds) issues.push(issue("dependency_cycle", id));
  return issues;
}

/** A task's own targets and required context are separate from the dependency graph. */
function taskContextIssues(task: DateExecutionTask, currentPlan: AIPlannerReply | null,
  visiblePlaces: Array<AIChatStop | string>, sessionCandidates?: SessionCandidateContext | null): DateExecutionIssue[] {
  const issues: DateExecutionIssue[] = [];
  if ((task.type === "modify_itinerary" || task.type === "save_itinerary") && !currentPlan)
    issues.push(issue("missing_current_plan", task.id));
  if (task.type === "inspect_venue" && !task.target) issues.push(issue("missing_target", task.id));
  if (task.type === "compare_places" && (task.targets?.length ?? 0) < 2)
    issues.push(issue("missing_target", task.id));
  if (task.type === "modify_itinerary" && task.changes?.some(change => needsChangeTarget(change.operation)
    && !change.target)) issues.push(issue("missing_target", task.id));
  if (task.type === "modify_itinerary" && task.changes?.some(change => change.operation === "reorder")
    && (task.targets?.length ?? 0) !== 2) issues.push(issue("missing_target", task.id));
  const targets = [task.target, ...(task.targets ?? []), ...(task.changes ?? []).map(change => change.target),
    ...(task.feedback ?? []).map(item => item.target)].filter((item): item is DateExecutionTarget => Boolean(item));
  if (targets.some(target => !targetExists(target, currentPlan, visiblePlaces, task.type, sessionCandidates)))
    issues.push(issue("unverified_reference", task.id));
  if (task.condition?.kind === "unsupported_predicate") issues.push(issue("unsupported_condition", task.id));
  return issues;
}

export function validateDateExecutionTasks(plan: DateExecutionPlan, currentPlan: AIPlannerReply | null = null,
  visiblePlaces: Array<AIChatStop | string> = [], sessionCandidates?: SessionCandidateContext | null,
  checkContext = true): TaskValidationResult[] {
  const issues = structuralIssues(plan);
  if (checkContext) for (const task of plan.tasks)
    issues.push(...taskContextIssues(task, currentPlan, visiblePlaces, sessionCandidates));
  const byId = new Map(plan.tasks.map(task => [task.id, task]));
  // Preserve interpretation-time issues that cannot be reconstructed from resolved targets.
  for (const prior of plan.unresolved) if (prior.taskId) issues.push(prior);
  const blocked = new Set(issues.map(item => item.taskId).filter((id): id is string => Boolean(id)));
  for (const task of plan.tasks) if (task.status !== "planned") blocked.add(task.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of plan.tasks) if (!blocked.has(task.id)
      && task.dependencies.some(id => blocked.has(id) || !byId.has(id))) {
      issues.push(issue("dependency_blocked", task.id));
      blocked.add(task.id);
      changed = true;
    }
  }
  const distinct = [...new Map(issues.map(item => [`${item.code}:${item.taskId ?? ""}`, item])).values()];
  return plan.tasks.map(task => {
    const blockingIssues = distinct.filter(item => item.taskId === task.id);
    return { taskId: task.id,
      valid: blockingIssues.every(item => item.code === "dependency_blocked") && task.status === "planned",
      executable: !blocked.has(task.id), blockingIssues, warnings: [] };
  });
}

/** Graph validation for a dispatcher that has no executor-specific application context. */
export function validateDateExecutionStructure(plan: DateExecutionPlan): TaskValidationResult[] {
  return validateDateExecutionTasks(plan, null, [], null, false);
}

export function validateDateExecutionTask(plan: DateExecutionPlan, taskId: string,
  currentPlan: AIPlannerReply | null = null, visiblePlaces: Array<AIChatStop | string> = [],
  sessionCandidates?: SessionCandidateContext | null): TaskValidationResult | undefined {
  return validateDateExecutionTasks(plan, currentPlan, visiblePlaces, sessionCandidates)
    .find(result => result.taskId === taskId);
}

/** Compatibility API for callers that inspect the issue list. */
export function validateDateExecutionPlan(plan: DateExecutionPlan, currentPlan: AIPlannerReply | null = null,
  visiblePlaces: Array<AIChatStop | string> = [], sessionCandidates?: SessionCandidateContext | null): DateExecutionIssue[] {
  return [...new Map(validateDateExecutionTasks(plan, currentPlan, visiblePlaces, sessionCandidates)
    .flatMap(result => result.blockingIssues)
    .map(item => [`${item.code}:${item.taskId ?? ""}`, item])).values()];
}

/** Pure shadow planner. Goal order is preserved unless a dependency is explicitly known. */
export function buildDateExecutionPlan(input: {
  understanding: DateTurnUnderstanding;
  currentPlan?: AIPlannerReply | null;
  visiblePlaces?: Array<AIChatStop | string>;
  sessionCandidates?: SessionCandidateContext | null;
  source?: DateExecutionPlan["source"];
}): DateExecutionPlan {
  const { understanding } = input;
  const currentPlan = input.currentPlan ?? null;
  const visible = input.visiblePlaces ?? [];
  const goals = understanding.goals.filter(goal => goal.type !== "general_chat" || understanding.goals.length === 1);
  if (understanding.feedback.some(item => item.explicit) && !goals.some(goal => goal.type === "provide_feedback"))
    goals.unshift({ type: "provide_feedback", confidence: Math.max(...understanding.feedback.map(item => item.confidence)) });
  const tasks: DateExecutionTask[] = goals.map((goal, index) => {
    const reference = likelyReference(goal, understanding);
    const type = goalTask[goal.type];
    const sessionTarget = ["explain_recommendation", "record_feedback"].includes(type)
      && reference?.kind === "previous_place"
      && reference.resolvedId && reference.resolvedName
      && input.sessionCandidates?.records.some(row => row.candidateId === reference.resolvedId
        && row.name === reference.resolvedName && (row.shownCount > 0 || row.rejectedReasons.length > 0))
      ? { kind: "place" as const, placeId: reference.resolvedId, name: reference.resolvedName } : null;
    const target = verifiedExecutionTarget(reference, currentPlan, visible) ?? sessionTarget;
    const task: DateExecutionTask = { id: `task-${index + 1}`, type, goal: goal.type,
      ...(target ? { target } : {}), dependencies: [], executionOrder: index + 1,
      confidence: goal.confidence, status: "planned", source: sourceFor(goal.type, understanding) };
    if (type === "inspect_venue") task.question = { attribute: goal.attribute };
    if (type === "explain_recommendation") task.referenceRequested = Boolean(goal.target);
    if (type === "compare_places") task.targets = understanding.references
      .map(item => verifiedExecutionTarget(item, currentPlan, visible)
        ?? (item.resolvedId && item.resolvedName && input.sessionCandidates?.records.some(row =>
          row.candidateId === item.resolvedId && row.name === item.resolvedName
          && (row.shownCount > 0 || row.currentState === "selected" || row.rejectedReasons.length > 0))
          ? { kind: "place" as const, placeId: item.resolvedId, name: item.resolvedName } : null))
      .filter((item): item is DateExecutionTarget => Boolean(item))
      .filter((item, position, all) => all.findIndex(other => other.placeId === item.placeId && other.name === item.name) === position);
    if (type === "modify_itinerary") task.changes = understanding.requestedChanges.map(change => {
      const fallbackReference = understanding.requestedChanges.length === 1 ? reference : undefined;
      const changeTarget = verifiedExecutionTarget(change.target ?? fallbackReference, currentPlan, visible);
      return { operation: change.operation, confidence: change.confidence,
        ...(changeTarget ? { target: changeTarget } : {}),
        ...(change.replacementPreference ? { replacementPreference: {
          dimension: change.replacementPreference.dimension, value: change.replacementPreference.value } } : {}),
        ...(change.explicitValue !== undefined ? { explicitValue: change.explicitValue } : {}) };
    });
    if (type === "modify_itinerary" && task.changes?.some(change => change.operation === "reorder")) {
      task.targets = understanding.references.map(reference => verifiedExecutionTarget(reference, currentPlan, visible))
        .filter((item): item is DateExecutionTarget => Boolean(item))
        .filter((item, position, all) => all.findIndex(other => other.placeId === item.placeId && other.name === item.name) === position);
    }
    if (type === "record_feedback") task.feedback = understanding.feedback.filter(item => item.explicit).map(item => {
      const feedbackTarget = verifiedExecutionTarget(item.target, currentPlan, visible)
        ?? (item.target?.resolvedId && item.target.resolvedName
          && input.sessionCandidates?.records.some(row => row.candidateId === item.target?.resolvedId
            && row.name === item.target?.resolvedName && (row.shownCount > 0
              || row.currentState === "selected" || row.rejectedReasons.length > 0))
          ? { kind: "place" as const, placeId: item.target.resolvedId, name: item.target.resolvedName } : null);
      return { attribute: item.attribute, sentiment: item.sentiment,
        strength: item.strength, confidence: item.confidence,
        ...(feedbackTarget ? { target: feedbackTarget } : {}) };
    });
    return task;
  });

  const recommend = tasks.find(task => task.type === "recommend_places");
  const modify = tasks.find(task => task.type === "modify_itinerary");
  const explain = tasks.find(task => task.type === "explain_recommendation");
  if (modify && explain && modify.executionOrder < explain.executionOrder
    && modify.changes?.some(change => change.operation === "replace")
    && understanding.rawMessage.split(/[.!?]/).some(clause =>
      /왜|이유/.test(clause) && /(?:새|바뀐|교체한)\s*(?:장소|식당|카페|곳)/.test(clause))) {
    explain.dependencies.push(modify.id);
    explain.deferredTarget = { kind: "mutation_output", sourceTaskId: modify.id };
    delete explain.target;
  }
  if (recommend && modify
    && modify.changes?.some(change => change.operation === "add" || change.operation === "replace")
    && /그\s*(?:걸|거|곳)|추천.{0,30}(?:코스|넣)/.test(understanding.rawMessage)) {
    modify.dependencies.push(recommend.id);
    // The new venue is the output of the prior task; it has no application ID yet.
    for (const change of modify.changes ?? []) if (change.operation === "add" || change.operation === "replace")
      delete change.target;
  }
  const inspect = tasks.find(task => task.type === "inspect_venue");
  if (inspect && recommend
    && /안\s*되면|불가하면|없으면/.test(understanding.rawMessage)) {
    recommend.dependencies.push(inspect.id);
    recommend.condition = { kind: "unsupported_predicate", afterTaskId: inspect.id,
      attribute: inspect.question?.attribute, expected: "unavailable" };
  }

  const draft: DateExecutionPlan = { tasks, unresolved: [], executable: true,
    source: input.source ?? "effective_understanding" };
  const issues = validateDateExecutionPlan(draft, currentPlan, visible, input.sessionCandidates);
  if (tasks.some(task => task.type === "compare_places")
    && understanding.references.some(reference => reference.kind === "unresolved")) {
    for (const task of tasks.filter(task => task.type === "compare_places"))
      issues.push(issue("unverified_reference", task.id));
  }
  for (const task of tasks) {
    const referencesNewRecommendation = task.type === "modify_itinerary"
      && task.dependencies.some(id => tasks.some(prior => prior.id === id && prior.type === "recommend_places"))
      && task.changes?.every(change => change.operation === "add");
    if (task.target === undefined && !referencesNewRecommendation && !task.deferredTarget
      && likelyReference(goals[task.executionOrder - 1], understanding)
      && ["modify_itinerary", "inspect_venue", "explain_recommendation", "record_feedback"].includes(task.type))
      issues.push(issue("unverified_reference", task.id));
  }
  const initial = [...new Map(issues.map(item => [`${item.code}:${item.taskId ?? ""}`, item])).values()];
  for (const task of tasks) if (initial.some(item => item.taskId === task.id)) {
    task.status = initial.some(item => item.taskId === task.id && (item.code === "unsupported_condition"
      || item.code === "missing_current_plan")) ? "blocked" : "unresolved";
  }
  const taskValidation = validateDateExecutionTasks({ ...draft, unresolved: initial }, currentPlan,
    visible, input.sessionCandidates);
  for (const task of tasks) if (taskValidation.find(row => row.taskId === task.id)?.blockingIssues
    .some(item => item.code === "dependency_blocked")) task.status = "blocked";
  const distinct = [...new Map(taskValidation.flatMap(row => row.blockingIssues)
    .map(item => [`${item.code}:${item.taskId ?? ""}`, item])).values()];
  const executableCount = taskValidation.filter(row => row.executable).length;
  return { ...draft, unresolved: distinct, taskValidation,
    executable: executableCount > 0,
    status: executableCount === 0 ? "blocked" : executableCount === tasks.length
      ? "executable" : "partially_executable" };
}

const routeTasks: Record<ChatRoute["mode"], DateExecutionTaskType[]> = {
  course: ["create_itinerary", "modify_itinerary"], places: ["recommend_places"],
  question: ["inspect_venue", "compare_places", "explain_recommendation"], chat: ["respond_chat"],
};

export function compareDateExecutionPlan(plan: DateExecutionPlan, route: ChatRoute | null): ExecutionPlanComparison {
  const plannedTaskTypes = plan.tasks.map(task => task.type);
  const coveredTasks = plan.tasks.filter(task => route && routeTasks[route.mode].includes(task.type)).map(task => task.type);
  const additionalTasks = plan.tasks.filter(task => !route || !routeTasks[route.mode].includes(task.type)).map(task => task.type);
  return { legacyRoute: route?.mode ?? null, plannedTaskTypes,
    routeCoverage: plan.tasks.length && coveredTasks.length === plan.tasks.length ? "full"
      : coveredTasks.length ? "partial" : "none",
    coveredTasks, additionalTasks,
    conflictingTasks: additionalTasks.filter(type => type !== "record_feedback" && type !== "save_itinerary"),
    blockedTasks: plan.tasks.filter(task => task.status !== "planned").map(task => task.type) };
}

export function executionPlanObservation(plan: DateExecutionPlan, comparison: ExecutionPlanComparison,
  timestamp: string): DateObservation {
  return { type: "execution_plan", source: "date_execution_planner", timestamp,
    data: { taskTypes: plan.tasks.map(task => task.type), taskCount: plan.tasks.length,
      validTaskCount: plan.taskValidation?.filter(row => row.valid).length
        ?? plan.tasks.filter(task => task.status === "planned").length,
      executableTaskCount: plan.taskValidation?.filter(row => row.executable).length
        ?? plan.tasks.filter(task => task.status === "planned").length,
      dependencyBlockedCount: plan.unresolved.filter(item => item.code === "dependency_blocked").length,
      blockedCount: plan.tasks.length - (plan.taskValidation?.filter(row => row.executable).length
        ?? plan.tasks.filter(task => task.status === "planned").length),
      unresolvedCount: plan.tasks.filter(task => task.status === "unresolved").length,
      dependencyCount: plan.tasks.reduce((count, task) => count + task.dependencies.length, 0),
      legacyRoute: comparison.legacyRoute, routeCoverage: comparison.routeCoverage,
      additionalTaskCount: comparison.additionalTasks.length,
      issueCodes: plan.unresolved.map(item => item.code) } };
}

/** Isolates diagnostics failures from the existing ChatRoute execution. */
export function observeDateExecutionPlan(input: { context: DateContext; route: ChatRoute | null;
  visiblePlaces?: Array<AIChatStop | string>; timestamp: string },
  planner: typeof buildDateExecutionPlan = buildDateExecutionPlan) {
  try {
    const understanding = input.context.shadowUnderstanding ?? input.context.effectiveUnderstanding;
    if (!understanding) return null;
    const plan = planner({ understanding, currentPlan: input.context.currentPlan,
      visiblePlaces: input.visiblePlaces, sessionCandidates: input.context.sessionCandidates,
      source: input.context.shadowUnderstanding ? "shadow_understanding" : "effective_understanding" });
    const comparison = compareDateExecutionPlan(plan, input.route);
    return { plan, comparison, observation: executionPlanObservation(plan, comparison, input.timestamp) };
  } catch {
    return null;
  }
}
