import type { AIChatCard, AIChatStop, AIPlannerReply, AIPlannerResult, AIPlannerState } from "@/features/planning/types/plan";
import { answerDateQuestion, fallbackQuestionCard, type QuestionContextStop } from "@/lib/openai/answerDateQuestion";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import type { ChatRoute } from "./chatRoute";
import { validateDateExecutionTask, type DateExecutionPlan, type DateExecutionTask } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";
import type { SessionCandidateContext } from "./sessionCandidates";
import type { DateMutationExecutionResult } from "./dateMutationExecution";
import type { ExplanationTaskExecutionResult } from "./dateRecommendationExplanation";
import type { PlaceRecommendationTaskExecutionResult } from "./datePlaceRecommendationExecution";
import type { PlaceComparisonExecutionResult } from "./datePlaceComparisonExecution";
import type { FeedbackTaskExecutionResult } from "./dateFeedbackExecution";

export type DateExecutionMode = "off" | "shadow" | "limited";
export type VenueQuestionType = "parking" | "opening_hours" | "reservation" | "pet_policy"
  | "accessibility" | "price" | "menu" | "location" | "general";
export type VenueInspectionRequest = {
  venueId: string | null;
  venueName: string;
  targetSource: "current_plan" | "visible_places";
  questionType: VenueQuestionType;
  requestedFacts: VenueQuestionType[];
  sourceTaskId: string;
};
export type ExecutionCoverageDecision = { coveredByLegacyRoute: boolean;
  shouldExecuteSupplementary: boolean; reason: "eligible" | "legacy_question_covered" | "no_primary_route" };
export type VenueInspectionTaskExecutionResult = { taskId: string; taskType: "inspect_venue";
  status: "success" | "skipped" | "failed"; source: "existing_venue_question";
  coveredByLegacyRoute: boolean; evidenceFound: boolean;
  failureCode?: "mode_disabled" | "interpreter_disabled" | "invalid_plan" | "not_planned"
    | "unverified_target" | "low_confidence" | "unsupported_condition" | "unmet_dependency"
    | "unsupported_question" | "duplicate" | "limit_reached" | "lookup_failed" | "lookup_timeout"
    | "legacy_question_covered" | "no_primary_route";
  data?: { request: VenueInspectionRequest; card: AIChatCard } };
export type DateTaskExecutionResult = VenueInspectionTaskExecutionResult | DateMutationExecutionResult
  | ExplanationTaskExecutionResult | PlaceRecommendationTaskExecutionResult
  | PlaceComparisonExecutionResult | FeedbackTaskExecutionResult;

const MIN_INSPECT_CONFIDENCE = 0.75;
const INSPECT_TIMEOUT_MS = 9000;
export const MAX_INSPECTIONS_PER_TURN = 3;

/** Invalid values fail closed; the older interpreter flag does not enable task execution. */
export function getDateExecutionMode(): DateExecutionMode {
  const mode = process.env.DATE_EXECUTION_PLAN_MODE?.trim().toLowerCase();
  return mode === "shadow" || mode === "limited" ? mode : "off";
}

export function inspectCoverage(route: ChatRoute | null): ExecutionCoverageDecision {
  if (route?.mode === "question") return { coveredByLegacyRoute: true,
    shouldExecuteSupplementary: false, reason: "legacy_question_covered" };
  if (!route) return { coveredByLegacyRoute: false,
    shouldExecuteSupplementary: false, reason: "no_primary_route" };
  return { coveredByLegacyRoute: false, shouldExecuteSupplementary: true, reason: "eligible" };
}

const categories: Array<{ type: Exclude<VenueQuestionType, "general">; aliases: string[];
  cue: RegExp; question: string }> = [
  { type: "parking", aliases: ["parking", "주차"], cue: /주차|parking/i, question: "주차 가능 여부" },
  { type: "opening_hours", aliases: ["opening_hours", "hours", "영업시간", "영업"],
    cue: /영업|휴무|몇\s*시|언제\s*(?:열|닫)/, question: "영업시간과 휴무일" },
  { type: "reservation", aliases: ["reservation", "예약"], cue: /예약|reservation/i, question: "예약 가능 여부" },
  { type: "pet_policy", aliases: ["pet_policy", "pet", "반려동물", "애견"],
    cue: /반려|애견|동물|pet/i, question: "반려동물 동반 가능 여부" },
  { type: "accessibility", aliases: ["accessibility", "휠체어", "접근성"],
    cue: /휠체어|접근성|장애인|accessible/i, question: "휠체어 접근 가능 여부" },
  { type: "price", aliases: ["price", "가격", "비용"], cue: /가격|비용|얼마|price/i, question: "가격" },
  { type: "menu", aliases: ["menu", "메뉴"], cue: /메뉴|시그니처|대표\s*음식|menu/i, question: "메뉴" },
  { type: "location", aliases: ["location", "위치", "주소"], cue: /위치|주소|어디에|location/i, question: "주소와 위치" },
];

export function venueQuestionType(attribute: string | undefined, userMessage: string): VenueQuestionType {
  const entry = categories.find(item => item.aliases.includes(attribute?.trim().toLowerCase() ?? ""));
  // The model's category alone is insufficient: this turn must actually ask for the fact.
  return entry && entry.cue.test(userMessage) ? entry.type : "general";
}

function verifiedVenue(task: DateExecutionTask, currentPlan: AIPlannerReply | null,
  visiblePlaces: AIChatStop[], courseStops: AIChatStop[]): { request: VenueInspectionRequest;
    stop: QuestionContextStop } | null {
  const target = task.target;
  if (!target || target.kind === "plan") return null;
  if (target.kind === "plan_item") {
    if (!target.placeId) return null;
    const places = currentPlan?.recommendations.filter(place =>
      place.placeId === target.placeId && place.name === target.name) ?? [];
    const item = currentPlan?.items.find(row => row.placeId === target.placeId && row.placeName === target.name);
    if (places.length > 1 || (!places.length && !item)) return null;
    const place = places[0];
    // UI stops have no ID. Reuse their extra facts only when the stored address identifies the same venue.
    const shown = courseStops.filter(stop => stop.name === target.name && place?.address
      && stop.address && stop.address === place.address);
    const stop: QuestionContextStop = shown.length === 1 ? shown[0] : {
      name: target.name, meta: place?.category ?? item?.category ?? "장소",
      address: place?.address, phone: place?.phone, mapUrl: place?.mapUrl,
      dishes: place?.dishes, factSourceUrl: place?.factSourceUrl,
    };
    return { request: { venueId: target.placeId, venueName: target.name,
      targetSource: "current_plan", questionType: "general", requestedFacts: [], sourceTaskId: task.id }, stop };
  }
  if (target.placeId) return null;
  const matches = visiblePlaces.filter(stop => stop.name === target.name);
  if (matches.length !== 1) return null;
  return { request: { venueId: null, venueName: matches[0].name,
    targetSource: "visible_places", questionType: "general", requestedFacts: [], sourceTaskId: task.id },
    stop: matches[0] };
}

export function inspectEligibility(input: { plan: DateExecutionPlan; task: DateExecutionTask;
  interpreterMode: DateTurnInterpreterMode; executionMode: DateExecutionMode;
  route: ChatRoute | null; currentPlan: AIPlannerReply | null; visiblePlaces: AIChatStop[];
  courseStops: AIChatStop[]; userMessage: string; sessionCandidates?: SessionCandidateContext | null }): { request: VenueInspectionRequest;
    stop: QuestionContextStop } | { failureCode: NonNullable<VenueInspectionTaskExecutionResult["failureCode"]> } {
  if (input.executionMode !== "limited") return { failureCode: "mode_disabled" };
  if (input.interpreterMode !== "assist") return { failureCode: "interpreter_disabled" };
  const coverage = inspectCoverage(input.route);
  if (!coverage.shouldExecuteSupplementary) return { failureCode: coverage.coveredByLegacyRoute
    ? "legacy_question_covered" : "no_primary_route" };
  if (!validateDateExecutionTask(input.plan, input.task.id, input.currentPlan,
    input.visiblePlaces, input.sessionCandidates)?.executable) return { failureCode: "invalid_plan" };
  if (input.task.type !== "inspect_venue" || input.task.status !== "planned") return { failureCode: "not_planned" };
  if (input.task.condition) return { failureCode: "unsupported_condition" };
  if (input.task.dependencies.length) return { failureCode: "unmet_dependency" };
  if (input.task.confidence < MIN_INSPECT_CONFIDENCE) return { failureCode: "low_confidence" };
  const venue = verifiedVenue(input.task, input.currentPlan, input.visiblePlaces, input.courseStops);
  if (!venue) return { failureCode: "unverified_target" };
  const questionType = venueQuestionType(input.task.question?.attribute, input.userMessage);
  if (questionType === "general") return { failureCode: "unsupported_question" };
  return { request: { ...venue.request, questionType, requestedFacts: [questionType] }, stop: venue.stop };
}

const questionText: Record<Exclude<VenueQuestionType, "general">, string> = Object.fromEntries(
  categories.map(item => [item.type, item.question])) as Record<Exclude<VenueQuestionType, "general">, string>;

function factAvailable(type: VenueQuestionType, stop: QuestionContextStop): boolean {
  if (type === "opening_hours") return Boolean(stop.openingHours);
  if (type === "menu") return Boolean(stop.dishes);
  if (type === "location") return Boolean(stop.address);
  return false;
}

type AnswerVenue = typeof answerDateQuestion;
async function withinInspectionBudget<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("lookup_timeout")), INSPECT_TIMEOUT_MS);
    })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function executeSupplementaryInspections(input: { plan: DateExecutionPlan | null;
  route: ChatRoute | null; interpreterMode: DateTurnInterpreterMode; executionMode: DateExecutionMode;
  currentPlan: AIPlannerReply | null; visiblePlaces: AIChatStop[]; courseStops: AIChatStop[];
  userMessage: string; state: AIPlannerState; sessionCandidates?: SessionCandidateContext | null;
  coupleTaste: { summary: string; commonTastes: string[]; avoidFoods: string[] } },
  answer: AnswerVenue = answerDateQuestion): Promise<{ results: VenueInspectionTaskExecutionResult[];
    observations: DateObservation[] }> {
  if (!input.plan) return { results: [], observations: [] };
  const pending: Array<Promise<VenueInspectionTaskExecutionResult>> = [];
  const dedupe = new Set<string>();
  let scheduled = 0;
  for (const task of input.plan.tasks.filter(item => item.type === "inspect_venue")) {
    const base = { taskId: task.id, taskType: "inspect_venue" as const,
      source: "existing_venue_question" as const,
      coveredByLegacyRoute: inspectCoverage(input.route).coveredByLegacyRoute };
    const eligibility = inspectEligibility({ ...input, plan: input.plan, task });
    if ("failureCode" in eligibility) {
      pending.push(Promise.resolve({ ...base, status: "skipped", evidenceFound: false,
        failureCode: eligibility.failureCode }));
      continue;
    }
    const { request, stop } = eligibility;
    const key = `${request.venueId ?? request.venueName}\u0000${request.questionType}`;
    if (dedupe.has(key)) {
      pending.push(Promise.resolve({ ...base, status: "skipped", evidenceFound: false, failureCode: "duplicate" }));
      continue;
    }
    dedupe.add(key);
    if (scheduled >= MAX_INSPECTIONS_PER_TURN) {
      pending.push(Promise.resolve({ ...base, status: "skipped", evidenceFound: false, failureCode: "limit_reached" }));
      continue;
    }
    scheduled += 1;
    const question = `${request.venueName} ${questionText[request.questionType as Exclude<VenueQuestionType, "general">]} 알려줘`;
    pending.push((async (): Promise<VenueInspectionTaskExecutionResult> => {
      try {
        const card = await withinInspectionBudget(answer({ message: question, state: input.state,
          stops: [stop], coupleTaste: input.coupleTaste, lookupTimeoutMs: INSPECT_TIMEOUT_MS - 1000 }));
        const evidenceFound = Boolean(card.sources?.length) || factAvailable(request.questionType, stop);
        // A source-free generated sentence must never turn an unknown practical fact into a claim.
        const groundedCard = evidenceFound ? card : fallbackQuestionCard(question, [stop], input.state, stop);
        return { ...base, status: "success", evidenceFound, data: { request, card: groundedCard } };
      } catch (error) {
        return { ...base, status: "failed", evidenceFound: false,
          failureCode: error instanceof Error && error.message === "lookup_timeout" ? "lookup_timeout" : "lookup_failed" };
      }
    })());
  }
  const results = await Promise.all(pending);
  const timestamp = new Date().toISOString();
  const observations: DateObservation[] = results.map(result => ({ type: "task_execution",
    source: "date_venue_inspection", timestamp,
    data: { taskType: result.taskType, status: result.status, coveredByLegacyRoute: result.coveredByLegacyRoute,
      evidenceFound: result.evidenceFound, failureCode: result.failureCode ?? null } }));
  return { results, observations };
}

/** Existing AIPlannerResult fields remain the wire contract; only successful supplemental text is appended. */
export function appendVenueInspectionResults<T extends AIPlannerResult>(primary: T,
  results: VenueInspectionTaskExecutionResult[]): T {
  const additions = results.filter(result => result.status === "success" && result.data);
  if (!additions.length) return primary;
  const lines = additions.flatMap(result => result.data!.card.lines.map(line =>
    line.trim().startsWith(result.data!.request.venueName)
      ? line : `${result.data!.request.venueName}: ${line}`));
  const sources = additions.flatMap(result => result.data!.card.sources ?? []);
  const existing = primary.card.sources ?? [];
  const uniqueSources = [...new Map([...existing, ...sources].map(source => [source.url, source])).values()];
  return { ...primary, message: `${primary.message} ${lines.join(" ")}`.trim(), card: {
    ...primary.card, lines: [...primary.card.lines, ...lines],
    ...(uniqueSources.length ? { sources: uniqueSources } : {}),
  } };
}
