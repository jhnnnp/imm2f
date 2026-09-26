import type { AIChatStop, AIPlannerReply } from "@/features/planning/types/plan";
import { extractAreasFromText } from "./dateBrief";
import { candidateFoodConflict, type DateIntent } from "./dateIntent";
import type { DateFeedback, DateReference, DateTurnUnderstanding, SemanticPreference } from "./dateTurnUnderstanding";

export const SEMANTIC_DIMENSIONS = ["pace", "novelty", "atmosphere", "crowd", "noise", "activity_level",
  "indoor_outdoor", "romantic", "exploration", "food_focus"] as const;
export type SemanticDimension = typeof SEMANTIC_DIMENSIONS[number];
export const MIN_ASSIST_CONFIDENCE = 0.75;

/** Hard facts remain separate; this order applies when a later reader combines soft signals. */
export const SEMANTIC_AUTHORITY_ORDER = ["current_explicit_hard_constraint", "current_semantic_preference",
  "verified_current_feedback", "stored_explicit_preference", "inferred_memory_preference",
  "legacy_semantic_heuristic"] as const;

export type SemanticSignalRejectionReason = "insufficient_confidence" | "unsupported_dimension"
  | "not_grounded" | "hard_constraint_conflict" | "superseded";
export type SemanticSignalDecision = {
  dimension: string;
  accepted: boolean;
  source: "llm";
  confidence: number;
  rejectionReason?: SemanticSignalRejectionReason;
};
export type FeedbackDecision = { accepted: boolean; attribute: string | null;
  reason?: "insufficient_confidence" | "not_grounded" | "not_attribute_level" };
export type EffectiveUnderstandingResult = {
  effectiveUnderstanding: DateTurnUnderstanding;
  semanticSignals: SemanticSignalDecision[];
  feedbackDecisions: FeedbackDecision[];
  acceptedFeedbackCount: number;
  unresolvedFeedbackCount: number;
  ambiguityCount: number;
};

const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const grounded = (message: string, evidence: string) => Boolean(evidence.trim())
  && compact(message).includes(compact(evidence));

const dimensionAliases: Record<string, SemanticDimension> = {
  vibe: "atmosphere", activity: "activity_level", food: "food_focus",
};
const evidenceCues: Record<SemanticDimension, RegExp> = {
  pace: /여유|천천|빡빡|느긋|바쁘|이동|시간|서두르/,
  novelty: /뻔|새롭|색다르|다른|특별|지난번|반복|익숙/,
  atmosphere: /분위기|감성|무드|예쁘|이쁘|아름|아늑/,
  crowd: /사람|붐비|한적|조용|복잡|북적|혼잡/,
  noise: /시끄럽|소음|조용|대화|조용히/,
  activity_level: /활동|재밌|놀|체험|액티브|쉬고|편안/,
  indoor_outdoor: /실내|야외|밖|비|날씨|바람/,
  romantic: /로맨틱|낭만|데이트다운|기념일|설레|특별/,
  exploration: /탐험|새로운|돌아다|여기저기|발견|구경/,
  food_focus: /음식|맛집|먹|식사|미식|요리|파스타|회|해산물|메뉴/,
};
const hardOnlyDimensions = new Set(["budget", "budgetwon", "price_limit", "date", "time", "start_time",
  "end_time", "area", "location", "required_place", "excluded_place", "excluded_food"]);

function dimensionOf(value: string): SemanticDimension | null {
  const key = value.trim().toLowerCase();
  const canonical = dimensionAliases[key] ?? key;
  return (SEMANTIC_DIMENSIONS as readonly string[]).includes(canonical) ? canonical as SemanticDimension : null;
}

function conflictsWithHardConstraint(preference: SemanticPreference, dimension: SemanticDimension,
  hard: DateIntent["hardConstraints"]) {
  if (/\d\s*(?:만\s*원|원|시)|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}/.test(preference.value)) return true;
  const statedAreas = extractAreasFromText(preference.value);
  if (hard.areas.length && statedAreas.some(area => !hard.areas.includes(area))) return true;
  if (preference.sentiment !== "negative" && hard.excludedPlaces.some(place =>
    compact(preference.value).includes(compact(place)))) return true;
  if (dimension !== "food_focus" || preference.sentiment === "negative" || !hard.excludedFoods.length) return false;
  const value = preference.value.replace(/seafood/gi, "해산물").replace(/raw\s*fish/gi, "회");
  return candidateFoodConflict(value, hard.excludedFoods);
}

function verifiedFeedbackTarget(target: DateReference | undefined, currentPlan: AIPlannerReply | null,
  visiblePlaces: Array<AIChatStop | string>): DateReference | undefined {
  if (!target) return undefined;
  const planPlaces = currentPlan?.recommendations ?? [];
  if (target.resolvedId) {
    const match = planPlaces.find(place => place.placeId === target.resolvedId && place.name === target.resolvedName);
    if (match) return { ...target, resolvedId: match.placeId, resolvedName: match.name };
  } else if (target.resolvedName) {
    const planMatches = planPlaces.filter(place => place.name === target.resolvedName);
    const shownMatches = visiblePlaces.filter(place =>
      (typeof place === "string" ? place : place.name) === target.resolvedName);
    if (planMatches.length === 1 && !shownMatches.length) return {
      ...target, resolvedId: planMatches[0].placeId, resolvedName: planMatches[0].name,
    };
    if (!planMatches.length && shownMatches.length === 1) return { ...target, resolvedName: target.resolvedName };
  }
  return { text: target.text, kind: "unresolved", targetType: target.targetType,
    confidence: Math.min(target.confidence, 0.4) };
}

function feedbackKey(item: DateFeedback) {
  return `${item.attribute ?? "overall"}:${item.sentiment}:${item.target?.resolvedId ?? item.target?.text ?? ""}`;
}

/** Promote only grounded current-turn semantics into a read model. Execution inputs stay legacy. */
export function buildEffectiveDateTurnUnderstanding(input: {
  legacy: DateTurnUnderstanding;
  llm: DateTurnUnderstanding;
  hardConstraints: DateIntent["hardConstraints"];
  currentPlan?: AIPlannerReply | null;
  visiblePlaces?: Array<AIChatStop | string>;
}): EffectiveUnderstandingResult {
  const { legacy, llm, hardConstraints } = input;
  const message = legacy.rawMessage;
  const accepted: SemanticPreference[] = [];
  const semanticSignals: SemanticSignalDecision[] = [];
  // A current-turn LLM signal outranks legacy heuristic and stored inferred memory, never a hard fact.
  for (const preference of [...llm.semanticPreferences].sort((a, b) => b.confidence - a.confidence)) {
    const dimension = dimensionOf(preference.dimension);
    const reason: SemanticSignalRejectionReason | null = hardOnlyDimensions.has(preference.dimension.trim().toLowerCase())
      ? "hard_constraint_conflict"
      : !dimension ? "unsupported_dimension"
        : preference.confidence < MIN_ASSIST_CONFIDENCE ? "insufficient_confidence"
          : !grounded(message, preference.evidenceText) || !evidenceCues[dimension].test(preference.evidenceText)
            ? "not_grounded"
            : conflictsWithHardConstraint(preference, dimension, hardConstraints) ? "hard_constraint_conflict"
              : accepted.some(item => item.dimension === dimension) ? "superseded" : null;
    semanticSignals.push({ dimension: dimension ?? "unsupported", accepted: !reason, source: "llm",
      confidence: preference.confidence, ...(reason ? { rejectionReason: reason } : {}) });
    if (!reason && dimension) accepted.push({ ...preference, dimension, source: "llm" });
  }

  const semanticPreferences = [...accepted, ...legacy.semanticPreferences.filter(item =>
    !accepted.some(promoted => promoted.dimension === (dimensionOf(item.dimension) ?? item.dimension)))];
  const feedbackDecisions: FeedbackDecision[] = [];
  const acceptedFeedback: DateFeedback[] = [];
  for (const item of llm.feedback) {
    const reason: FeedbackDecision["reason"] = item.confidence < MIN_ASSIST_CONFIDENCE ? "insufficient_confidence"
      : !item.attribute || item.attribute === "overall" ? "not_attribute_level"
        : !grounded(message, item.evidenceText) ? "not_grounded" : undefined;
    feedbackDecisions.push({ accepted: !reason, attribute: item.attribute ?? null, ...(reason ? { reason } : {}) });
    if (reason) continue;
    acceptedFeedback.push({ ...item, source: "llm", target: verifiedFeedbackTarget(item.target,
      input.currentPlan ?? null, input.visiblePlaces ?? []) });
  }
  const feedback = [...acceptedFeedback, ...legacy.feedback].filter((item, index, all) =>
    all.findIndex(other => feedbackKey(other) === feedbackKey(item)) === index);
  const ambiguities = [...new Set([...legacy.ambiguities, ...llm.ambiguities])];
  const effectiveUnderstanding: DateTurnUnderstanding = {
    ...legacy,
    // These execution-sensitive fields remain exactly legacy-owned.
    goals: [...legacy.goals], references: [...legacy.references],
    explicitConstraints: { ...legacy.explicitConstraints },
    requestedChanges: [...legacy.requestedChanges],
    semanticPreferences, feedback, ambiguities,
    provenance: [...legacy.provenance,
      ...accepted.map(item => ({ field: "semanticPreferences" as const, source: "llm" as const, key: item.dimension })),
      ...acceptedFeedback.map(item => ({ field: "feedback" as const, source: "llm" as const, key: item.attribute }))],
  };
  return { effectiveUnderstanding, semanticSignals, feedbackDecisions,
    acceptedFeedbackCount: acceptedFeedback.length,
    unresolvedFeedbackCount: feedback.filter(item => !item.target?.resolvedId && !item.target?.resolvedName).length,
    ambiguityCount: ambiguities.length };
}
