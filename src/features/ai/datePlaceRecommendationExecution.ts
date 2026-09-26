import type { AIChatStop, AIPlannerReply, AIPlannerResult, AIPlannerState, PlaceAsk } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import { detectPlaceKind, placeQueryFromMessage, type ChatRoute } from "./chatRoute";
import { extractAreasFromText, selectedAreas } from "./dateBrief";
import { buildDateCandidatePool, type DateCandidateRecord } from "./dateCandidatePool";
import { dateCandidateKey } from "./dateCourse";
import { validateDateExecutionTask, type DateExecutionPlan, type DateExecutionTask } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";
import { getReusableCandidates, isSessionEvidenceStale, type SessionCandidateContext,
  type SessionCandidateRecord } from "./sessionCandidates";
import type { DateExecutionMode } from "./dateVenueInspection";
import { PLACE_PICK_MIN, filterPlaceCandidates, placeAskHarshAllow } from "./placeRecommend";
import { allowsHarshDateMeal } from "./dateCourse";
import { isDateCourseCandidate } from "@/lib/kakao/dateCandidate";
import { applyTasteHarshAllow, violatesTasteAvoid } from "@/features/taste/compare";
import { placeSessionFeedbackSignals, type PlaceSessionFeedbackSignal,
  type SessionFeedbackContext } from "./sessionFeedback";

export type PlaceRecommendationTaskExecutionResult = {
  taskId: string; taskType: "recommend_places"; status: "success" | "skipped" | "failed";
  source: "existing_place_recommendation"; coveredByLegacyRoute: boolean;
  failureCode?: "mode_disabled" | "interpreter_disabled" | "invalid_plan" | "not_planned"
    | "low_confidence" | "unsupported_condition" | "legacy_places_covered" | "missing_place_ask"
    | "no_primary_route" | "unresolved_rejection" | "no_eligible_candidates" | "recommendation_failed";
  reusedCount: number; searched: boolean; selectedCandidateIds: string[];
  card?: AIPlannerResult["card"];
};

export type PlaceRecommendationCapability = (input: { message: string; ask: PlaceAsk;
  state: AIPlannerState;
  reusable: DiscoverCandidate[]; search: boolean; excludedCandidateIds: string[];
  sessionFeedbackSignals?: PlaceSessionFeedbackSignal[];
  observeCandidates: (records: DateCandidateRecord[]) => void }) => Promise<AIPlannerResult>;

const MIN_CONFIDENCE = 0.75;
const DAY_MS = 86_400_000;
const isFresh = (when: string | undefined, now: string, maxAge = DAY_MS) => {
  const age = Date.parse(now) - Date.parse(when ?? "");
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
};

/** Historic facts are leads. Drop expired practical facts before re-running today's eligibility. */
export function currentSessionVenue(row: SessionCandidateRecord, now: string,
  state: AIPlannerState): DiscoverCandidate | null {
  const venue = row.venue;
  if (!venue || dateCandidateKey(venue) !== row.candidateId) return null;
  const latest = row.facts.at(-1);
  const practicalFresh = isFresh(latest?.observedAt, now);
  const factFresh = (attribute: "hours" | "price") => {
    const evidence = row.evidence.filter(item => item.attribute === attribute);
    return practicalFresh && (!evidence.length || evidence.some(item => !isSessionEvidenceStale(item, now)));
  };
  // An expired known price cannot prove a current numeric budget is satisfied.
  if (state.budgetWon != null && venue.expectedCostTwo != null && !factFresh("price")) return null;
  return { ...venue,
    openingHours: factFresh("hours") ? venue.openingHours : undefined,
    expectedCostTwo: factFresh("price") ? venue.expectedCostTwo : undefined,
    performanceEvent: venue.performanceEvent && isFresh(venue.performanceEvent.checkedAt, now)
      ? venue.performanceEvent : undefined,
    evidence: (venue.evidence ?? []).filter(fact => isFresh(fact.checkedAt, now, 30 * DAY_MS)),
    factNote: practicalFresh ? venue.factNote : undefined,
  };
}

export function reusablePlaceCandidates(input: { session: SessionCandidateContext | null | undefined;
  ask: PlaceAsk; state: AIPlannerState; message: string; now: string;
  avoidFoods?: string[] }): DiscoverCandidate[] {
  if (!input.session) return [];
  const inventory = getReusableCandidates(input.session, input.now);
  const reviveRejected = /(?:아까|이전|전에).*(?:제외|뺐|거절)/.test(input.message);
  const rejected = inventory.rejected;
  // A vague historic rejection cannot authorize an arbitrary previously rejected venue.
  const named = rejected.filter(row => input.message.replace(/\s/g, "").includes(row.name.replace(/\s/g, "")));
  const revived = reviveRejected ? (named.length === 1 ? named : named.length === 0 && rejected.length === 1 ? rejected : []) : [];
  const rows = [...input.session.records.filter(row => inventory.unseenEligibleIds.includes(row.candidateId)), ...revived];
  const shown = new Set([...inventory.alreadyShownIds, ...inventory.selectedIds]);
  const candidates = rows.filter(row => !shown.has(row.candidateId) || revived.includes(row))
    .filter(row => row.venue && (row.venue.searchRegion === input.ask.area
      || row.area?.includes(input.ask.area) || input.ask.area.includes(row.area ?? "\u0000")))
    .map(row => currentSessionVenue(row, input.now, input.state))
    .filter((venue): venue is DiscoverCandidate => Boolean(venue));
  const allowHarsh = placeAskHarshAllow(input.message, input.ask,
    applyTasteHarshAllow(allowsHarshDateMeal(input.message), input.message, input.avoidFoods ?? []));
  const pool = buildDateCandidatePool(candidates, input.state, undefined,
    candidate => isDateCourseCandidate(candidate, input.state.requiredPlaces));
  const allowed = filterPlaceCandidates(pool.eligible, input.ask, {
    allowHarsh, exclude: input.state.excludedPlaces,
    violatesAvoid: blob => violatesTasteAvoid(blob, input.avoidFoods ?? []),
  });
  const eligibleIds = new Set(allowed.map(dateCandidateKey));
  return candidates.filter(candidate => eligibleIds.has(dateCandidateKey(candidate)));
}

/** Shared by a covered legacy places route and the supplementary executor. */
export function sessionPlaceRecommendationInputs(input: Parameters<typeof reusablePlaceCandidates>[0]) {
  const reusable = reusablePlaceCandidates(input);
  const reusableIds = new Set(reusable.map(dateCandidateKey));
  const excludedCandidateIds = input.session?.records.filter(row => !reusableIds.has(row.candidateId)
    && (row.shownCount > 0 || row.currentState === "selected" || row.rejectedReasons.length > 0))
    .map(row => row.candidateId) ?? [];
  return { reusable, search: reusable.length < PLACE_PICK_MIN, excludedCandidateIds };
}

export function placeRecommendationCoverage(route: ChatRoute | null) {
  return { coveredByLegacyRoute: route?.mode === "places", shouldExecute: Boolean(route && route.mode !== "places") };
}

export function legacyPlacesReuseEnabled(input: { session: SessionCandidateContext | null | undefined;
  interpreterMode: DateTurnInterpreterMode; executionMode: DateExecutionMode;
  plan: DateExecutionPlan | null | undefined }): boolean {
  return Boolean(input.session && input.interpreterMode === "assist" && input.executionMode === "limited"
    && input.plan?.tasks.some(task => task.type === "recommend_places" && task.status === "planned"
      && validateDateExecutionTask(input.plan!, task.id)?.executable));
}

export async function executeLimitedPlaceRecommendation(input: {
  plan: DateExecutionPlan; task: DateExecutionTask; route: ChatRoute | null;
  interpreterMode: DateTurnInterpreterMode; executionMode: DateExecutionMode;
  state: AIPlannerState; message: string; sessionCandidates?: SessionCandidateContext | null;
  currentPlan?: AIPlannerReply | null; visiblePlaces?: AIChatStop[];
  avoidFoods?: string[]; recommend: PlaceRecommendationCapability;
  sessionFeedback?: SessionFeedbackContext | null; currentTurnId?: string;
  observeCandidates?: (records: DateCandidateRecord[]) => void;
  now?: string;
}): Promise<{ result: PlaceRecommendationTaskExecutionResult; observation: DateObservation }> {
  const coverage = placeRecommendationCoverage(input.route);
  const base: PlaceRecommendationTaskExecutionResult = { taskId: input.task.id, taskType: "recommend_places",
    status: "skipped", source: "existing_place_recommendation",
    coveredByLegacyRoute: coverage.coveredByLegacyRoute, reusedCount: 0, searched: false,
    selectedCandidateIds: [] };
  const finish = (result: PlaceRecommendationTaskExecutionResult) => ({ result,
    observation: { type: "task_execution" as const, source: "date_place_recommendation" as const,
      timestamp: new Date().toISOString(), data: { taskType: "recommend_places" as const,
        status: result.status, coveredByLegacyRoute: result.coveredByLegacyRoute,
        reusedCount: result.reusedCount, searched: result.searched,
        selectedCount: result.selectedCandidateIds.length, failureCode: result.failureCode ?? null } } });
  const skip = (failureCode: NonNullable<PlaceRecommendationTaskExecutionResult["failureCode"]>) =>
    finish({ ...base, failureCode });
  if (input.executionMode !== "limited") return skip("mode_disabled");
  if (input.interpreterMode !== "assist") return skip("interpreter_disabled");
  if (coverage.coveredByLegacyRoute) return skip("legacy_places_covered");
  if (!coverage.shouldExecute) return skip("no_primary_route");
  if (!validateDateExecutionTask(input.plan, input.task.id, input.currentPlan ?? null,
    input.visiblePlaces ?? [], input.sessionCandidates)?.executable) return skip("invalid_plan");
  if (input.task.type !== "recommend_places" || input.task.status !== "planned") return skip("not_planned");
  if (input.task.condition) return skip("unsupported_condition");
  if (input.task.confidence < MIN_CONFIDENCE) return skip("low_confidence");
  const kind = detectPlaceKind(input.message) ?? input.state.placeAsk?.kind;
  const area = extractAreasFromText(input.message)[0] ?? selectedAreas(input.state)[0]
    ?? input.state.placeAsk?.area;
  if (!kind || !area) return skip("missing_place_ask");
  const ask: PlaceAsk = { kind, area, query: placeQueryFromMessage(input.message, kind) };
  if (/(?:아까|이전|전에).*(?:제외|뺐|거절)/.test(input.message)) {
    const rejected = input.sessionCandidates?.records.filter(row => row.rejectedReasons.length) ?? [];
    const named = rejected.filter(row => input.message.replace(/\s/g, "")
      .includes(row.name.replace(/\s/g, "")));
    if (named.length !== 1 && !(named.length === 0 && rejected.length === 1))
      return skip("unresolved_rejection");
  }
  const now = input.now ?? new Date().toISOString();
  const { reusable, search, excludedCandidateIds } = sessionPlaceRecommendationInputs({
    session: input.sessionCandidates, ask, state: input.state,
    message: input.message, now, avoidFoods: input.avoidFoods });
  const reusableIds = new Set(reusable.map(dateCandidateKey));
  try {
    const observed = new Map<string, Set<string>>();
    const selected = await input.recommend({ message: input.message, ask, state: input.state, reusable, search,
      sessionFeedbackSignals: placeSessionFeedbackSignals(input.sessionFeedback, input.currentTurnId ?? ""),
      excludedCandidateIds, observeCandidates: records => {
        // Reusing a session snapshot must not renew its fact or evidence timestamps.
        input.observeCandidates?.(records.filter(record => !reusableIds.has(record.id)));
        for (const record of records) {
          const key = `${record.venue.name}\u0000${record.venue.roadAddress || record.venue.address}`;
          const ids = observed.get(key) ?? new Set<string>();
          ids.add(record.id); observed.set(key, ids);
        }
      } });
    if (!selected.card.stops?.length) return finish({ ...base, status: "failed", searched: search,
      reusedCount: reusable.length, failureCode: "no_eligible_candidates" });
    const selectedIds = selected.card.stops.map(stop => {
      const matches = reusable.filter(candidate => candidate.name === stop.name
        && (candidate.roadAddress || candidate.address) === stop.address);
      if (matches.length === 1) return dateCandidateKey(matches[0]);
      const recorded = [...(observed.get(`${stop.name}\u0000${stop.address ?? ""}`) ?? [])];
      return recorded.length === 1 ? recorded[0] : "";
    }).filter(Boolean);
    return finish({ ...base, status: "success", searched: search, reusedCount: reusable.length,
      selectedCandidateIds: selectedIds, card: selected.card });
  } catch {
    return finish({ ...base, status: "failed", searched: search, reusedCount: reusable.length,
      failureCode: "recommendation_failed" });
  }
}

export function appendPlaceRecommendation(primary: AIPlannerResult,
  result: PlaceRecommendationTaskExecutionResult | null): AIPlannerResult {
  if (result?.status !== "success" || !result.card) return primary;
  const identity = (stop: AIChatStop) => `${stop.name.normalize("NFKC")}\u0000${stop.address ?? ""}`;
  const seen = new Set((primary.card.stops ?? []).map(identity));
  const suggested = (result.card.stops ?? []).filter(stop => {
    const key = identity(stop);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const removedDuplicates = suggested.length !== (result.card.stops ?? []).length;
  if (removedDuplicates && !suggested.length) return primary;
  const lines = primary.status === "plan" || removedDuplicates
    ? ["추가 장소 추천", ...suggested.map(stop => `${stop.name}${stop.address ? ` · ${stop.address}` : ""}`)]
    : ["추가 장소 추천", ...result.card.lines];
  const sources = [...new Map([...(primary.card.sources ?? []), ...(result.card.sources ?? [])]
    .map(source => [source.url, source])).values()];
  return { ...primary, message: `${primary.message} ${lines.join(" ")}`.trim(), card: {
    ...primary.card, lines: [...primary.card.lines, ...lines],
    ...(primary.status === "plan" ? {} : { stops: [...(primary.card.stops ?? []), ...suggested] }),
    ...(sources.length ? { sources } : {}),
  } };
}
