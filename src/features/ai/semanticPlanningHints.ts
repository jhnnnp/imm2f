import type { DateContext } from "./dateContext";
import { MIN_ASSIST_CONFIDENCE } from "./dateTurnAssist";
import type { DateTurnUnderstanding, SemanticPreference } from "./dateTurnUnderstanding";

/** Soft course-level wishes only. No constraints, venue facts, IDs, or execution decisions. */
export type SemanticPlanningHints = {
  pace?: "relaxed" | "active";
  novelty?: "high" | "low";
  atmosphere?: "warm" | "romantic" | "lively";
  crowdPreference?: "low" | "high";
  noisePreference?: "quiet" | "lively";
  activityLevel?: "high" | "low";
  indoorOutdoor?: "indoor" | "outdoor";
  romantic?: "high";
  exploration?: "high" | "low";
  foodFocus?: "high" | "low";
  /** Current-turn feedback is a wish, never evidence about another venue. */
  sessionFeedback?: Array<{ attribute: "aesthetic" | "crowd" | "noise"; sentiment: "positive" | "negative" }>;
};

const normalized = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const has = (value: string, pattern: RegExp) => pattern.test(normalized(value));

function addPreference(hints: SemanticPlanningHints, signal: SemanticPreference) {
  const value = signal.value;
  const negative = signal.sentiment === "negative";
  switch (signal.dimension) {
    case "pace":
      if (has(value, /relax|slow|leisure|여유|느긋|천천|덜.?빡빡/)) hints.pace = negative ? "active" : "relaxed";
      else if (has(value, /active|fast|packed|빡빡|빠르/)) hints.pace = negative ? "relaxed" : "active";
      break;
    case "novelty":
      if (has(value, /high|new|novel|unique|less.cliche|unusual|색다|새롭|안.?뻔|덜.?뻔/)) hints.novelty = negative ? "low" : "high";
      else if (has(value, /low|familiar|generic|cliche|익숙|뻔/)) hints.novelty = negative ? "high" : "low";
      break;
    case "atmosphere":
      if (!negative && has(value, /warm|cozy|calm|아늑|따뜻|차분|분위기/)) hints.atmosphere = "warm";
      else if (!negative && has(value, /romantic|로맨틱|낭만/)) hints.atmosphere = "romantic";
      else if (!negative && has(value, /lively|활기/)) hints.atmosphere = "lively";
      break;
    case "crowd":
      if (has(value, /low|less|uncrowded|quiet|한적|조용|적은/)) hints.crowdPreference = negative ? "high" : "low";
      else if (has(value, /high|crowd|busy|붐비|혼잡|많은/)) hints.crowdPreference = negative ? "low" : "high";
      break;
    case "noise":
      if (has(value, /quiet|low|calm|조용|낮은/)) hints.noisePreference = negative ? "lively" : "quiet";
      else if (has(value, /noisy|loud|high|시끄럽|소음/)) hints.noisePreference = negative ? "quiet" : "lively";
      break;
    case "activity_level":
      if (has(value, /high|active|많이|활동|액티브/)) hints.activityLevel = negative ? "low" : "high";
      else if (has(value, /low|rest|쉬|편안/)) hints.activityLevel = negative ? "high" : "low";
      break;
    case "indoor_outdoor":
      if (has(value, /indoor|실내/)) hints.indoorOutdoor = negative ? "outdoor" : "indoor";
      else if (has(value, /outdoor|야외|바깥/)) hints.indoorOutdoor = negative ? "indoor" : "outdoor";
      break;
    case "romantic":
      if (!negative && has(value, /high|romantic|date|로맨틱|낭만|데이트/)) hints.romantic = "high";
      break;
    case "exploration":
      if (has(value, /high|explor|discover|탐험|발견|구경/)) hints.exploration = negative ? "low" : "high";
      else if (has(value, /low|familiar|익숙/)) hints.exploration = negative ? "high" : "low";
      break;
    case "food_focus":
      // This is only the amount of emphasis on dining, never a cuisine or menu claim.
      if (has(value, /high|focus|food|dining|음식|식사|미식/)) hints.foodFocus = negative ? "low" : "high";
      else if (has(value, /low|less/)) hints.foodFocus = negative ? "high" : "low";
      break;
  }
}

/** Reads only approved current-turn LLM signals; ambiguities and legacy heuristics create no hints. */
export function buildSemanticPlanningHints(effectiveUnderstanding: DateTurnUnderstanding | null): SemanticPlanningHints {
  if (!effectiveUnderstanding) return {};
  const hints: SemanticPlanningHints = {};
  for (const signal of effectiveUnderstanding.semanticPreferences) {
    if (signal.source === "llm" && signal.confidence >= MIN_ASSIST_CONFIDENCE) addPreference(hints, signal);
  }
  const feedback = effectiveUnderstanding.feedback.filter(item => item.source === "llm" && item.attribute
    && item.confidence >= MIN_ASSIST_CONFIDENCE
    && ["aesthetic", "crowd", "noise"].includes(item.attribute))
    .map(item => ({ attribute: item.attribute as "aesthetic" | "crowd" | "noise", sentiment: item.sentiment }));
  if (feedback.length) hints.sessionFeedback = feedback;
  return hints;
}

export function semanticPlanningHintsForContext(context: Pick<DateContext, "interpreterMode" | "effectiveUnderstanding">): SemanticPlanningHints {
  return context.interpreterMode === "assist" ? buildSemanticPlanningHints(context.effectiveUnderstanding) : {};
}

export function hasSemanticPlanningHints(hints: SemanticPlanningHints): boolean {
  return Object.keys(hints).length > 0;
}
