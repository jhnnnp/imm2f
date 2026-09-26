import type { AIPlannerReply, AIPlannerResult, PlanItem } from "@/features/planning/types/plan";
import type { DateEvidenceFact } from "./dateEvidence";
import type { DateCandidateRecord } from "./dateCandidatePool";
import type { DateContext } from "./dateContext";
import type { ChatRoute } from "./chatRoute";
import { validateDateExecutionTask, type DateExecutionPlan, type DateExecutionTarget } from "./dateExecutionPlan";
import type { DateMutationExecutionResult } from "./dateMutationExecution";
import type { DateObservation } from "./dateObservation";
import type { SemanticPlanningHints } from "./semanticPlanningHints";
import type { SessionCandidateRecord } from "./sessionCandidates";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import type { DateExecutionMode } from "./dateVenueInspection";

export type ExplanationTargetKind = "entire_plan" | "specific_place" | "specific_plan_item"
  | "ordering" | "timing" | "recommendation_choice";
export type ExplanationFactType = "hard_constraint" | "semantic_preference" | "candidate_fact"
  | "route" | "schedule" | "course_evaluation" | "memory";
export type RecommendationExplanationFact = { type: ExplanationFactType; summary: string;
  source: string; confidence?: number; evidenceId?: string };
export type RecommendationExplanationTarget = { kind: ExplanationTargetKind;
  itemId?: string; venueId?: string; name?: string };
export type RecommendationExplanationContext = {
  target: RecommendationExplanationTarget;
  selectedPlanItems: Array<Pick<PlanItem, "id" | "placeId" | "placeName" | "startTime"
    | "durationMinutes" | "dayIndex" | "order">>;
  relevantCandidateFacts: RecommendationExplanationFact[];
  relevantEvidence: DateEvidenceFact[];
  applicableHardConstraints: RecommendationExplanationFact[];
  applicableSemanticHints: SemanticPlanningHints;
  routeFacts: RecommendationExplanationFact[];
  scheduleFacts: RecommendationExplanationFact[];
  evaluationFacts: RecommendationExplanationFact[];
  facts: RecommendationExplanationFact[];
};
export type ExplanationTaskExecutionResult = { taskId: string; taskType: "explain_recommendation";
  source: "verified_plan_facts"; status: "success" | "skipped" | "failed";
  target?: RecommendationExplanationTarget; explanation?: string;
  sources?: Array<{ label: string; url: string }>;
  factTypesUsed: ExplanationFactType[]; evidenceCount: number; coveredByLegacyRoute: boolean;
  failureCode?: "mode_disabled" | "interpreter_disabled" | "invalid_plan" | "not_planned"
    | "low_confidence" | "unsupported_condition" | "unmet_dependency" | "unresolved_target"
    | "missing_plan" | "target_disappeared" | "mutation_failed" | "ambiguous_plan"
    | "legacy_answer_covered" | "explanation_failed" };

type Input = { plan: DateExecutionPlan | null; route: ChatRoute | null; primary: AIPlannerResult;
  currentPlan: AIPlannerReply | null; resultAfterMutation: AIPlannerResult;
  mutationResult?: DateMutationExecutionResult | null; interpreterMode: DateTurnInterpreterMode;
  executionMode: DateExecutionMode; userMessage: string;
  context?: Pick<DateContext, "hardConstraints" | "candidates" | "sessionCandidates"> | null;
  candidateRecords?: DateCandidateRecord[];
  semanticHints?: SemanticPlanningHints };
const MIN_CONFIDENCE = 0.75;
const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const direct = (value: string, cue: RegExp) => cue.test(value);
const safeHttpUrl = (value: string | null) => {
  if (!value) return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
};
const explanationClause = (message: string) => {
  const clause = message.split(/[.!?]/).find(part => /왜|이유|설명/.test(part)) ?? message;
  const why = clause.indexOf("왜");
  return why >= 0 ? clause.slice(why) : clause;
};
const topicParticle = (name: string) => {
  const last = name.charCodeAt(name.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 ? "은" : "는";
};

function selectTarget(message: string, target?: DateExecutionTarget): RecommendationExplanationTarget | null {
  message = explanationClause(message);
  if (!/왜|이유|설명/.test(message)) return null;
  const kind: ExplanationTargetKind = direct(message, /(?:순서|먼저|다음|앞에|뒤에)/) ? "ordering"
    : direct(message, /(?:시간|몇\s*시간|얼마나|\d\s*시간|\d\s*분|체류)/) ? "timing"
      : direct(message, /(?:다른|대신|선택지|후보)/) && target?.kind === "plan_item"
        ? "recommendation_choice"
        : target?.kind === "plan_item" ? /(?:\d+\s*번|첫|두|세)\s*(?:번째|째|장소)?/.test(message)
          ? "specific_plan_item" : "specific_place"
          : "entire_plan";
  if (target?.kind === "place") return null;
  return { kind, ...(target?.kind === "plan_item" ? { venueId: target.placeId, name: target.name } : {}) };
}

function resolveSelected(target: RecommendationExplanationTarget, plan: AIPlannerReply): RecommendationExplanationTarget | null {
  if (!target.venueId) return target;
  const matches = plan.items.filter(item => item.placeId === target.venueId && item.placeName === target.name);
  const venues = plan.recommendations.filter(place => place.placeId === target.venueId && place.name === target.name);
  return matches.length === 1 && venues.length === 1
    ? { ...target, itemId: matches[0].id } : null;
}

function verifiedMutationOutput(input: Input): RecommendationExplanationTarget | null {
  if (input.mutationResult?.status !== "success" || input.mutationResult.operation !== "replace"
    || input.resultAfterMutation.status !== "plan" || !input.currentPlan) return null;
  const prior = new Set(input.currentPlan.items.map(item => item.placeId));
  const added = input.resultAfterMutation.items.filter(item => !prior.has(item.placeId));
  if (added.length !== 1 || !input.resultAfterMutation.recommendations.some(place =>
    place.placeId === added[0].placeId && place.name === added[0].placeName)) return null;
  return { kind: "recommendation_choice", itemId: added[0].id,
    venueId: added[0].placeId, name: added[0].placeName };
}

function coveredByLegacyQuestion(input: Input, target: RecommendationExplanationTarget,
  plan: AIPlannerReply): boolean {
  if (input.route?.mode !== "question" || input.primary.status !== "chat") return false;
  const response = `${input.primary.card.headline} ${input.primary.card.lines.join(" ")}`;
  const substantive = target.kind === "ordering" ? /순서|동선|먼저.*(?:이유|때문)/.test(response)
    : target.kind === "timing" ? /체류|시간.*(?:이유|기준|설정|때문)|배정/.test(response)
      : target.kind === "entire_plan" ? /코스.*(?:추천|구성|이유)|동선|이유|근거/.test(response)
        : /추천|골랐|고른|선택|포함|이유|근거/.test(response)
          || plan.recommendations.some(place => place.placeId === target.venueId
            && place.reasons.some(reason => reason.length >= 8 && response.includes(reason)));
  const targetCovered = !target.name || compact(response).includes(compact(target.name));
  return substantive && targetCovered;
}

/** Read only the selected plan and verified candidate observations. */
export function buildRecommendationExplanationContext(input: { plan: AIPlannerReply;
  target: RecommendationExplanationTarget; records?: DateCandidateRecord[];
  hardConstraints?: DateContext["hardConstraints"]; semanticHints?: SemanticPlanningHints }): RecommendationExplanationContext {
  const { plan, target } = input;
  const selected = target.venueId ? plan.recommendations.filter(place => place.placeId === target.venueId)
    : plan.recommendations;
  const records = (input.records ?? []).filter(record => !record.rejectedReasons.length
    && selected.some(place => place.id === record.id && place.name === record.venue.name));
  const evidence = records.flatMap(record => record.evidence.filter(fact =>
    (fact.verification === "source_checked" || fact.verification === "provider")
    && safeHttpUrl(fact.sourceUrl) && fact.confidence >= 0.6));
  const candidateFacts: RecommendationExplanationFact[] = selected.map(place => ({ type: "candidate_fact",
    summary: `${place.name}: ${place.activitySlot === "cafe" ? "카페" : place.activitySlot === "meal" ? "식사" : place.category} 역할`,
    source: `selected:${place.placeId}` }));
  candidateFacts.push(...evidence.map(fact => ({ type: "candidate_fact" as const,
    summary: `${fact.attribute}: ${(fact.excerpt ?? "").slice(0, 180)}`,
    source: fact.sourceUrl!, confidence: fact.confidence, evidenceId: `${fact.venueId}:${fact.attribute}:${fact.retrievedAt}` })));
  const hard: RecommendationExplanationFact[] = [];
  if (input.hardConstraints?.areas.includes(plan.condition.region)) hard.push({ type: "hard_constraint",
    summary: `요청 지역: ${plan.condition.region}`, source: "date_intent" });
  if (input.hardConstraints?.date && input.hardConstraints.date === plan.condition.dateLabel) hard.push({
    type: "hard_constraint", summary: `요청 날짜: ${plan.condition.dateLabel}`, source: "date_intent" });
  if (input.hardConstraints?.budgetWon != null && input.hardConstraints.budgetWon === plan.condition.budget)
    hard.push({ type: "hard_constraint", summary: `예산 기준: ${plan.condition.budget}원`, source: "date_intent" });
  const schedule: RecommendationExplanationFact[] = plan.items
    .filter(item => !target.venueId || item.placeId === target.venueId)
    .map(item => ({ type: "schedule", summary: `${item.placeName}: ${item.startTime} 시작, ${item.durationMinutes}분 체류`,
      source: `plan_item:${item.id}` }));
  const route: RecommendationExplanationFact[] = plan.design?.routeBasis === "walking"
    && Number.isFinite(plan.design.totalDistanceMeters)
    ? [{ type: "route", summary: `확인된 보행 경로 총 ${Math.round(plan.design.totalDistanceMeters)}m`,
      source: "verified_walking_route" }] : [];
  const evaluation: RecommendationExplanationFact[] = plan.design?.evidenceCoverage
    && plan.design.evidenceCoverage.totalStops === plan.items.length
    ? [{ type: "course_evaluation", summary: `선정 근거 확인 ${plan.design.evidenceCoverage.supportedStops}/${plan.design.evidenceCoverage.totalStops}곳`,
      source: "course_evaluation" }] : [];
  const hints = input.semanticHints ?? {};
  const semantic: RecommendationExplanationFact[] = hints.pace === "relaxed" && plan.items.length <= 3
    ? [{ type: "semantic_preference", summary: `현재 턴의 여유로운 구성 요청과 ${plan.items.length}곳 구성`,
      source: "approved_semantic_hint" }] : [];
  return { target, selectedPlanItems: plan.items.map(({ id, placeId, placeName, startTime,
    durationMinutes, dayIndex, order }) => ({ id, placeId, placeName, startTime, durationMinutes, dayIndex, order })),
  relevantCandidateFacts: candidateFacts, relevantEvidence: evidence, applicableHardConstraints: hard,
  applicableSemanticHints: hints, routeFacts: route, scheduleFacts: schedule, evaluationFacts: evaluation,
  facts: [...hard, ...semantic, ...candidateFacts, ...route, ...schedule, ...evaluation] };
}

const rejectionReason: Record<string, string> = { excluded_place: "제외 요청한 장소예요",
  excluded_food: "제외한 음식과 충돌해요", over_budget: "확인된 비용이 예산을 넘어요",
  event_date_mismatch: "공연·행사 날짜가 방문일과 맞지 않아요", search_policy: "현재 탐색 조건에 맞지 않아요" };

/** A rejected candidate is explained directly from its exact pool record, without an LLM call. */
export function explainRejectedCandidate(record: Pick<DateCandidateRecord, "rejectedReasons"> & {
  venue: Pick<DateCandidateRecord["venue"], "name"> }): string | null {
  const reasons = record.rejectedReasons.map(reason => rejectionReason[reason]).filter(Boolean);
  return reasons.length ? `${record.venue.name}은 ${reasons.join(". ")} 그래서 이번 후보에서 제외했어요.` : null;
}

/** Historical rejections are phrased as past decisions, never as current venue facts. */
export function explainSessionRejectedCandidate(record: SessionCandidateRecord): string | null {
  if (!record.events.some(event => event.type === "rejected" && event.source === "candidate_pool")) return null;
  return explainRejectedCandidate({ venue: { name: record.name }, rejectedReasons: record.rejectedReasons })
    ?.replace("이번 후보에서", "당시 후보에서") ?? null;
}

/** Deliberately deterministic: no model can add a venue property absent from the facts above. */
export function renderRecommendationExplanation(context: RecommendationExplanationContext): string {
  const { target, selectedPlanItems: items } = context;
  const chosen = target.venueId ? items.find(item => item.placeId === target.venueId) : undefined;
  const role = context.relevantCandidateFacts.find(fact => fact.source === `selected:${target.venueId}`)?.summary;
  const supported = context.relevantEvidence[0];
  const lines: string[] = [];
  if (target.kind === "ordering") {
    lines.push(`현재 순서는 ${items.map(item => item.placeName).join(" → ")}예요.`);
    lines.push(context.routeFacts.length ? context.routeFacts[0].summary + "로 확인됐어요."
      : "이 순서가 다른 순서보다 이동에 유리하다는 비교 근거는 확인되지 않았어요.");
  } else if (target.kind === "timing") {
    if (chosen) lines.push(`${chosen.placeName}은 ${chosen.startTime}에 시작해 ${chosen.durationMinutes}분 머무르도록 잡혀 있어요.`);
    else lines.push(`현재 코스는 ${items[0]?.startTime ?? "시작 시간 미확인"}부터 ${items.length}곳으로 구성돼 있어요.`);
    lines.push("이 체류 시간이 최적인지에 대한 별도 비교 근거는 아직 없어요.");
  } else if (chosen) {
    lines.push(`${chosen.placeName}${topicParticle(chosen.placeName)} 현재 코스에서 ${role?.split(": ")[1] ?? "해당 장소 역할"}을 맡는 ${items.findIndex(item => item.id === chosen.id) + 1}번째 장소예요.`);
    if (supported?.excerpt) lines.push(`확인된 장소 자료에는 ${supported.excerpt.slice(0, 120)} 내용이 있어요.`);
    else lines.push("이 장소의 분위기나 소음 등 세부 특성을 뒷받침할 근거는 아직 확인되지 않았어요.");
  } else {
    const area = context.applicableHardConstraints.find(fact => fact.summary.startsWith("요청 지역:"))?.summary.split(":")[1]?.trim();
    lines.push(`${area ? `${area} 지역의` : "현재"} 코스는 ${items.length}곳을 ${items.map(item => item.placeName).join(" → ")} 순서로 방문하도록 구성돼 있어요.`);
    if (context.routeFacts.length) lines.push(`${context.routeFacts[0].summary}로 확인됐어요.`);
    if (context.evaluationFacts.length) lines.push(`${context.evaluationFacts[0].summary}이에요.`);
  }
  if (context.facts.some(fact => fact.type === "semantic_preference"))
    lines.push(`이번 턴의 여유로운 구성 요청과 현재 ${items.length}곳 구성은 일치해요.`);
  return lines.join(" ");
}

export async function executeLimitedExplanation(input: Input,
  render: typeof renderRecommendationExplanation = renderRecommendationExplanation): Promise<{
    result: ExplanationTaskExecutionResult | null; observation: DateObservation | null }> {
  const task = input.plan?.tasks.find(row => row.type === "explain_recommendation");
  if (!task) return { result: null, observation: null };
  const base = { taskId: task.id, taskType: "explain_recommendation" as const,
    source: "verified_plan_facts" as const, factTypesUsed: [] as ExplanationFactType[],
    evidenceCount: 0, coveredByLegacyRoute: false };
  const finish = (result: ExplanationTaskExecutionResult) => ({ result,
    observation: { type: "task_execution" as const, source: "date_recommendation_explanation" as const,
      timestamp: new Date().toISOString(), data: { taskType: "explain_recommendation" as const,
        status: result.status, targetType: result.target?.kind ?? null, evidenceCount: result.evidenceCount,
        factTypesUsed: result.factTypesUsed, coveredByLegacyRoute: result.coveredByLegacyRoute,
        failureCode: result.failureCode ?? null } } });
  const skip = (failureCode: NonNullable<ExplanationTaskExecutionResult["failureCode"]>) =>
    finish({ ...base, status: "skipped", failureCode });
  if (input.executionMode !== "limited") return skip("mode_disabled");
  if (input.interpreterMode !== "assist") return skip("interpreter_disabled");
  if (task.status !== "planned") return skip("not_planned");
  if (task.condition) return skip("unsupported_condition");
  const referencePlan = input.currentPlan ?? (input.primary.status === "plan" ? input.primary : null);
  if (!input.plan || !validateDateExecutionTask(input.plan, task.id, input.currentPlan,
    [], input.context?.sessionCandidates)?.executable)
    return skip("invalid_plan");
  if (task.confidence < MIN_CONFIDENCE) return skip("low_confidence");
  if (!referencePlan) return skip("missing_plan");
  if (task.target?.kind === "place" && task.target.placeId) {
    const matches = input.context?.sessionCandidates?.records.filter(row =>
      row.candidateId === task.target?.placeId && row.name === task.target.name) ?? [];
    if (matches.length !== 1) return skip("unresolved_target");
    const target: RecommendationExplanationTarget = { kind: "specific_place",
      venueId: matches[0].venueId ?? matches[0].candidateId, name: matches[0].name };
    if (coveredByLegacyQuestion(input, target, referencePlan)) return finish({ ...base, status: "skipped",
      target, coveredByLegacyRoute: true, failureCode: "legacy_answer_covered" });
    const explanation = explainSessionRejectedCandidate(matches[0]);
    return explanation ? finish({ ...base, status: "success", target, explanation,
      factTypesUsed: ["candidate_fact"], evidenceCount: 0 })
      : skip("unresolved_target");
  }
  if (task.dependencies.length && (!task.deferredTarget || task.dependencies.length !== 1
    || task.dependencies[0] !== task.deferredTarget.sourceTaskId)) return skip("unmet_dependency");
  if (!task.deferredTarget && input.plan.tasks.some(row => row.type === "modify_itinerary")
    && !task.target) return skip("ambiguous_plan");
  if (!task.deferredTarget && task.target?.kind === "plan_item"
    && input.mutationResult?.status === "success" && input.resultAfterMutation.status === "plan"
    && !input.resultAfterMutation.items.some(item => item.placeId === task.target?.placeId
      && item.placeName === task.target?.name)) return skip("target_disappeared");
  const clause = explanationClause(input.userMessage);
  if (!task.deferredTarget && !task.target && (task.referenceRequested
    || /(?:이|그|저|새)\s*(?:카페|식당|장소|곳)|거기|\d+\s*번|(?:첫|두|세)\s*번째/.test(clause)
    || /왜\s+.+(?:추천|골랐|넣었)/.test(clause) && !/코스|일정|동선|플랜/.test(clause)))
    return skip("unresolved_target");
  let plan = referencePlan;
  let target: RecommendationExplanationTarget | null;
  if (task.deferredTarget) {
    target = verifiedMutationOutput(input);
    if (!target) return skip("mutation_failed");
    plan = input.resultAfterMutation as AIPlannerReply;
  } else {
    target = selectTarget(input.userMessage, task.target);
    if (!target) return skip("unresolved_target");
    target = resolveSelected(target, plan);
    if (!target) return skip("target_disappeared");
  }
  if (coveredByLegacyQuestion(input, target, plan)) return finish({ ...base, status: "skipped", target,
    coveredByLegacyRoute: true, failureCode: "legacy_answer_covered" });
  try {
    const context = buildRecommendationExplanationContext({ plan, target,
      records: input.candidateRecords ?? input.context?.candidates.records,
      hardConstraints: input.context?.hardConstraints,
      semanticHints: input.semanticHints });
    const explanation = render(context).trim();
    if (!explanation) return finish({ ...base, status: "failed", target, failureCode: "explanation_failed" });
    const used: ExplanationFactType[] = [];
    if (target.itemId) used.push("candidate_fact");
    if (target.kind === "timing") used.push("schedule");
    if ((target.kind === "ordering" || target.kind === "entire_plan") && context.routeFacts.length)
      used.push("route");
    if (target.kind === "entire_plan" && context.applicableHardConstraints.some(fact => fact.summary.startsWith("요청 지역:")))
      used.push("hard_constraint");
    if (target.kind === "entire_plan" && context.evaluationFacts.length) used.push("course_evaluation");
    if (context.facts.some(fact => fact.type === "semantic_preference")) used.push("semantic_preference");
    const cited = target.itemId && context.relevantEvidence[0]?.excerpt ? context.relevantEvidence[0] : null;
    return finish({ ...base, status: "success", target, explanation,
      ...(cited?.sourceUrl ? { sources: [{ label: "장소 근거", url: cited.sourceUrl }] } : {}),
      factTypesUsed: used, evidenceCount: cited ? 1 : 0 });
  } catch {
    return finish({ ...base, status: "failed", target, failureCode: "explanation_failed" });
  }
}

export function appendRecommendationExplanation<T extends AIPlannerResult>(primary: T,
  result: ExplanationTaskExecutionResult | null): T {
  if (result?.status !== "success" || !result.explanation) return primary;
  const line = `추천 이유: ${result.explanation}`;
  const sources = [...new Map([...(primary.card.sources ?? []), ...(result.sources ?? [])]
    .map(source => [source.url, source])).values()];
  return { ...primary, message: `${primary.message} ${line}`.trim(),
    card: { ...primary.card, lines: [...primary.card.lines, line],
      ...(sources.length ? { sources } : {}) } };
}
