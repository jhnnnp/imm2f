import type { AIChatStop, AIPlannerReply, AIPlannerResult, AIPlannerState } from "@/features/planning/types/plan";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import type { ChatRoute } from "./chatRoute";
import { buildDateCandidatePool, type DateCandidateRecord } from "./dateCandidatePool";
import type { DateEvidenceFact } from "./dateEvidence";
import { validateDateExecutionTask, type DateExecutionPlan, type DateExecutionTarget,
  type DateExecutionTask } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";
import { toDateIntent, type DateIntent } from "./dateIntent";
import { currentSessionVenue } from "./datePlaceRecommendationExecution";
import type { SemanticPlanningHints } from "./semanticPlanningHints";
import { isSessionEvidenceStale, type SessionCandidateContext,
  type SessionCandidateRecord } from "./sessionCandidates";
import type { DateExecutionMode } from "./dateVenueInspection";

export const PLACE_COMPARISON_CRITERIA = ["distance", "price", "atmosphere", "crowd", "noise",
  "menu", "opening_hours", "parking", "fit_for_course", "general"] as const;
export type PlaceComparisonCriterion = typeof PLACE_COMPARISON_CRITERIA[number];
export type PlaceComparisonRequest = { taskId: string; candidateIds: string[];
  comparisonCriteria: PlaceComparisonCriterion[];
  applicableConstraints: DateIntent["hardConstraints"];
  semanticHints: SemanticPlanningHints };
type VerifiedPlace = { candidateId: string; name: string;
  planPlace?: AIPlannerReply["recommendations"][number];
  session?: SessionCandidateRecord; record?: DateCandidateRecord };
type ComparisonFact = { value: string; source: string; sourceUrl?: string; evidence: boolean };
export type PlaceComparisonExecutionResult = { taskId: string; taskType: "compare_places";
  status: "success" | "skipped" | "failed"; source: "verified_candidate_facts";
  candidateIds: string[]; comparedFactTypes: PlaceComparisonCriterion[];
  unknownFactTypes: PlaceComparisonCriterion[]; evidenceCount: number;
  coveredByLegacyRoute: boolean; lines: string[];
  sources: Array<{ label: string; url: string }>;
  request?: PlaceComparisonRequest;
  failureCode?: "mode_disabled" | "interpreter_disabled" | "invalid_plan" | "not_planned"
    | "low_confidence" | "unsupported_condition" | "unverified_target"
    | "legacy_comparison_covered" | "comparison_failed" };

const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const fresh = (value: string, now: string, days: number) => {
  const age = Date.parse(now) - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age <= days * 86_400_000;
};
const safeUrl = (value: string | null | undefined) => {
  try { return value && ["http:", "https:"].includes(new URL(value).protocol) ? value : undefined; }
  catch { return undefined; }
};

export function comparisonCriteria(message: string): PlaceComparisonCriterion[] {
  const cues: Array<[PlaceComparisonCriterion, RegExp]> = [
    ["distance", /거리|가까|멀|이동|동선/], ["price", /가격|비용|예산|저렴|비싸/],
    ["atmosphere", /분위기|감성|아늑|로맨틱/], ["crowd", /붐비|혼잡|사람|한적/],
    ["noise", /시끄러|시끄럽|소음|조용/], ["menu", /메뉴|음식|파스타|커피/],
    ["opening_hours", /영업|휴무|몇\s*시/], ["parking", /주차/],
    ["fit_for_course", /코스|일정|적합|어울/],
  ];
  const picked = cues.filter(([, cue]) => cue.test(message)).map(([criterion]) => criterion);
  return picked.length ? picked.slice(0, 4) : ["general"];
}

/** Every ID is derived again from current application state, never from the task payload. */
export function verifiedComparisonPlace(target: DateExecutionTarget,
  currentPlan: AIPlannerReply | null, visiblePlaces: AIChatStop[],
  session: SessionCandidateContext | null | undefined,
  records: DateCandidateRecord[]): VerifiedPlace | null {
  if (target.kind === "plan_item") {
    const matches = currentPlan?.recommendations.filter(place => place.placeId === target.placeId
      && place.name === target.name) ?? [];
    if (matches.length !== 1) return null;
    const place = matches[0];
    const sessionMatches = session?.records.filter(row => row.candidateId === place.id
      || row.venueId === place.placeId) ?? [];
    return { candidateId: place.id || place.placeId, name: place.name, planPlace: place,
      ...(sessionMatches.length === 1 ? { session: sessionMatches[0] } : {}),
      ...(records.find(row => row.id === place.id && row.venue.name === place.name)
        ? { record: records.find(row => row.id === place.id && row.venue.name === place.name)! } : {}) };
  }
  if (target.kind !== "place") return null;
  if (target.placeId) {
    const matches = session?.records.filter(row => row.candidateId === target.placeId
      && row.name === target.name && (row.shownCount > 0 || row.currentState === "selected"
        || row.rejectedReasons.length > 0)) ?? [];
    return matches.length === 1 ? { candidateId: matches[0].candidateId,
      name: matches[0].name, session: matches[0],
      ...(records.find(row => row.id === matches[0].candidateId)
        ? { record: records.find(row => row.id === matches[0].candidateId)! } : {}) } : null;
  }
  const matches = visiblePlaces.map((stop, index) => ({ stop, index }))
    .filter(row => row.stop.name === target.name);
  if (matches.length !== 1) return null;
  const shown = matches[0];
  const sessionMatches = session?.records.filter(row => row.name === shown.stop.name
    && row.address && shown.stop.address && compact(row.address) === compact(shown.stop.address)) ?? [];
  return { candidateId: sessionMatches.length === 1 ? sessionMatches[0].candidateId
    : `visible:${shown.index}`, name: shown.stop.name,
    ...(sessionMatches.length === 1 ? { session: sessionMatches[0] } : {}) };
}

function evidenceFor(place: VerifiedPlace, criterion: PlaceComparisonCriterion, now: string): DateEvidenceFact | null {
  const attribute = criterion === "menu" ? "menu"
    : ["noise", "crowd", "atmosphere"].includes(criterion) ? "space" : null;
  if (!attribute) return null;
  const current = place.record?.evidence.filter(fact => fact.attribute === attribute
    && fact.verification === "source_checked" && fact.excerpt && fresh(fact.retrievedAt, now, 30)) ?? [];
  const previous = place.session?.evidence.filter(fact => fact.attribute === attribute
    && fact.verification === "source_checked" && fact.excerpt
    && !isSessionEvidenceStale(fact, now)) ?? [];
  return [...current, ...previous][0] ?? null;
}

function factFor(place: VerifiedPlace, criterion: PlaceComparisonCriterion,
  state: AIPlannerState, now: string): ComparisonFact | null {
  const record = place.record;
  const sessionVenue = place.session ? currentSessionVenue(place.session, now, state) : null;
  const venue = record?.venue ?? sessionVenue;
  if (criterion === "price") {
    const cost = record?.facts.costTwoWon ?? sessionVenue?.expectedCostTwo;
    return cost != null && cost > 0 ? { value: `${cost.toLocaleString("ko-KR")}원(2인 예상)`,
      source: record ? "current_candidate" : "session_candidate", evidence: false } : null;
  }
  if (criterion === "opening_hours") {
    const hours = record?.facts.openingHours ?? sessionVenue?.openingHours;
    return hours ? { value: hours, source: record ? "current_candidate" : "session_candidate",
      evidence: false } : null;
  }
  if (criterion === "distance") {
    const meters = place.planPlace?.distanceFromPreviousMeters;
    return meters != null && meters >= 0 ? { value: `직전 코스 장소에서 약 ${Math.round(meters)}m`,
      source: "verified_current_plan", evidence: false } : null;
  }
  if (criterion === "fit_for_course") {
    if (!venue) return place.planPlace ? { value: "현재 코스에 포함", source: "current_plan", evidence: false } : null;
    const assessed = buildDateCandidatePool([venue], state).records[0];
    return { value: assessed.rejectedReasons.length
      ? `현재 필수 조건과 충돌: ${assessed.rejectedReasons.join(", ")}`
      : place.planPlace ? "현재 코스에 포함 · 후보 필수 조건 통과" : "후보 필수 조건 통과(동선·시간은 미검증)",
    source: "date_candidate_pool", evidence: false };
  }
  if (criterion === "parking" || criterion === "general") return null;
  const evidence = evidenceFor(place, criterion, now);
  if (!evidence?.excerpt) return null;
  const excerpt = evidence.excerpt.slice(0, 160);
  const cue = criterion === "noise" ? /(조용|시끄러|시끄럽|소음|대화)/
    : criterion === "crowd" ? /(붐비|혼잡|한적|사람\s*(?:많|적))/
      : criterion === "atmosphere" ? /(분위기|아늑|로맨틱|감성)/ : /\S/;
  const match = excerpt.match(cue);
  if (!match) return null;
  return { value: criterion === "menu" ? excerpt : `자료에 '${match[0]}' 언급`,
    source: evidence.verification, sourceUrl: safeUrl(evidence.sourceUrl), evidence: true };
}

/** Dedupe needs both verified names, the requested criterion, and a substantive legacy comparison. */
export function legacyComparisonCovered(route: ChatRoute | null, primary: AIPlannerResult,
  names: string[], criteria: PlaceComparisonCriterion[]): boolean {
  if (route?.mode !== "question" || primary.status !== "chat") return false;
  const response = `${primary.card.headline} ${primary.card.lines.join(" ")}`;
  if (!names.every(name => compact(response).includes(compact(name)))) return false;
  if (!/비교|차이|더\s*(?:좋|낫|가깝|저렴)|반면|각각/.test(response)) return false;
  const criterionCue: Partial<Record<PlaceComparisonCriterion, RegExp>> = {
    distance: /거리|가깝|멀|이동/, price: /가격|비용|원|저렴|비싸/,
    atmosphere: /분위기|아늑|로맨틱|감성/, crowd: /붐비|혼잡|사람|한적/,
    noise: /조용|시끄러|시끄럽|소음/, menu: /메뉴|음식|요리/,
    opening_hours: /영업|휴무|시간/, parking: /주차/, fit_for_course: /코스|일정|동선/,
  };
  return criteria.every(criterion => criterion === "general" || criterionCue[criterion]?.test(response));
}

export async function executeLimitedComparison(input: { plan: DateExecutionPlan; task: DateExecutionTask;
  route: ChatRoute | null; primary: AIPlannerResult; interpreterMode: DateTurnInterpreterMode;
  executionMode: DateExecutionMode; currentPlan: AIPlannerReply | null;
  visiblePlaces: AIChatStop[]; sessionCandidates?: SessionCandidateContext | null;
  candidateRecords?: DateCandidateRecord[]; state: AIPlannerState; userMessage: string;
  semanticHints?: SemanticPlanningHints; now?: string }): Promise<{ result: PlaceComparisonExecutionResult;
    observation: DateObservation }> {
  const base: PlaceComparisonExecutionResult = { taskId: input.task.id, taskType: "compare_places",
    status: "skipped", source: "verified_candidate_facts", candidateIds: [],
    comparedFactTypes: [], unknownFactTypes: [], evidenceCount: 0,
    coveredByLegacyRoute: false, lines: [], sources: [] };
  const finish = (result: PlaceComparisonExecutionResult) => ({ result,
    observation: { type: "task_execution" as const, source: "date_place_comparison" as const,
      timestamp: new Date().toISOString(), data: { taskType: "compare_places" as const,
        status: result.status, targetCount: result.candidateIds.length,
        comparedFactTypes: result.comparedFactTypes,
        unknownFactTypes: result.unknownFactTypes,
        evidenceCount: result.evidenceCount, coveredByLegacyRoute: result.coveredByLegacyRoute,
        failureCode: result.failureCode ?? null } } });
  const skip = (failureCode: NonNullable<PlaceComparisonExecutionResult["failureCode"]>) =>
    finish({ ...base, failureCode });
  if (input.executionMode !== "limited") return skip("mode_disabled");
  if (input.interpreterMode !== "assist") return skip("interpreter_disabled");
  if (input.task.type !== "compare_places" || input.task.status !== "planned") return skip("not_planned");
  if (input.task.condition) return skip("unsupported_condition");
  if (input.task.confidence < 0.75) return skip("low_confidence");
  if (!validateDateExecutionTask(input.plan, input.task.id, input.currentPlan,
    input.visiblePlaces, input.sessionCandidates)?.executable) return skip("invalid_plan");
  const targets = input.task.targets ?? [];
  if (targets.length < 2 || targets.length > 4) return skip("unverified_target");
  const resolved = targets.map(target => verifiedComparisonPlace(target, input.currentPlan,
    input.visiblePlaces, input.sessionCandidates, input.candidateRecords ?? []));
  if (resolved.some(row => !row)) return skip("unverified_target");
  const places = resolved as VerifiedPlace[];
  if (new Set(places.map(row => row.candidateId)).size !== places.length) return skip("unverified_target");
  const criteria = comparisonCriteria(input.userMessage);
  const request: PlaceComparisonRequest = { taskId: input.task.id,
    candidateIds: places.map(row => row.candidateId), comparisonCriteria: criteria,
    applicableConstraints: toDateIntent(input.state).hardConstraints,
    semanticHints: input.semanticHints ?? {} };
  if (legacyComparisonCovered(input.route, input.primary, places.map(row => row.name), criteria))
    return finish({ ...base, candidateIds: request.candidateIds, request,
      status: "skipped", coveredByLegacyRoute: true, failureCode: "legacy_comparison_covered" });
  try {
    const now = input.now ?? new Date().toISOString();
    const considered = criteria[0] === "general"
      ? (["price", "distance", "menu", "fit_for_course"] as PlaceComparisonCriterion[]) : criteria;
    const comparedFactTypes: PlaceComparisonCriterion[] = [];
    const unknownFactTypes: PlaceComparisonCriterion[] = [];
    const lines: string[] = [];
    const sources: Array<{ label: string; url: string }> = [];
    let evidenceCount = 0;
    for (const criterion of considered) {
      const facts = places.map(place => factFor(place, criterion, input.state, now));
      if (facts.some(fact => !fact)) { unknownFactTypes.push(criterion); continue; }
      comparedFactTypes.push(criterion);
      for (const fact of facts) if (fact?.evidence) {
        evidenceCount += 1;
        if (fact.sourceUrl) sources.push({ label: "장소 비교 근거", url: fact.sourceUrl });
      }
      const label = { distance: "이동거리", price: "가격", atmosphere: "분위기", crowd: "혼잡도",
        noise: "소음", menu: "메뉴", opening_hours: "영업시간", parking: "주차",
        fit_for_course: "코스 적합성", general: "일반" }[criterion];
      lines.push(`${label}: ${places.map((place, index) => `${place.name} ${facts[index]!.value}`).join(" / ")}`);
    }
    if (!lines.length) lines.push(`${places.map(place => place.name).join("와 ")}의 요청하신 속성을 비교할 근거가 아직 부족해요.`);
    if (unknownFactTypes.length) lines.push(`확인되지 않은 항목: ${unknownFactTypes.join(", ")}.`);
    return finish({ ...base, status: "success", request, candidateIds: request.candidateIds,
      comparedFactTypes, unknownFactTypes, evidenceCount, lines,
      sources: [...new Map(sources.map(source => [source.url, source])).values()] });
  } catch {
    return finish({ ...base, status: "failed", request, candidateIds: request.candidateIds,
      failureCode: "comparison_failed" });
  }
}

export function appendPlaceComparison(primary: AIPlannerResult,
  result: PlaceComparisonExecutionResult | null): AIPlannerResult {
  if (result?.status !== "success") return primary;
  const lines = result.lines.map(line => `장소 비교: ${line}`);
  const sources = [...new Map([...(primary.card.sources ?? []), ...result.sources]
    .map(source => [source.url, source])).values()];
  return { ...primary, message: `${primary.message} ${lines.join(" ")}`.trim(), card: {
    ...primary.card, lines: [...primary.card.lines, ...lines],
    ...(sources.length ? { sources } : {}),
  } };
}
