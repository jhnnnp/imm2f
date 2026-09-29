import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import type { DateContext } from "./dateContext";
import { resolveRequiredActivities, type ActivityRequirement } from "./planningRequirementProvenance";
import { tripLocalWindows } from "./planningSupport";
import { dateSpine, courseSize } from "./dateBrief";

export type ExperienceDensity = "light" | "balanced" | "full";
export type ExperienceSupport = "meal" | "cafe" | "rest" | "shopping";
export type ExperienceQuality = { category: "cafe" | "meal" | "any";
  dimension: "aesthetic" | "atmosphere" | "quiet" | "scenic" | "view" | "romantic" | "spacious" | "traditional" | "hanok";
  source: "explicit_user" | "approved_semantic" };
export type ExperienceBlock = { purpose: string; primaryExperience: string;
  visitContext: string; supportingNeeds: ExperienceSupport[];
  qualitativeNeeds: ExperienceQuality[]; repeatJustification: string | null };
export type ExperienceDayPlan = { dayIndex: number; purpose: string;
  density: ExperienceDensity; geographicFocus: string | null;
  experienceBlocks: ExperienceBlock[] };
export type ExperiencePlan = { objective: string; overallPace: "relaxed" | "balanced" | "active";
  tripStrategy: { geographicApproach: string; experienceProgression: string;
    avoidRepeatedVisitContexts: boolean };
  days: ExperienceDayPlan[]; requiredElements: DateActivityId[];
  optionalElements: DateActivityId[]; qualitativeNeeds: ExperienceQuality[];
  uncertainties: string[] };

const activityIds = ["meal", "cafe", "walk", "exhibit", "movie", "performance", "indoor", "nightview"] as const;
const qualitySchema = { type: "object", additionalProperties: false,
  required: ["category", "dimension", "source"], properties: {
    category: { type: "string", enum: ["cafe", "meal", "any"] },
    dimension: { type: "string", enum: ["aesthetic", "atmosphere", "quiet", "scenic", "view", "romantic", "spacious", "traditional", "hanok"] },
    source: { type: "string", enum: ["explicit_user", "approved_semantic"] },
  } };
export const experiencePlanSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false,
  required: ["objective", "overallPace", "tripStrategy", "days", "requiredElements", "optionalElements", "qualitativeNeeds", "uncertainties"],
  properties: {
    objective: { type: "string" }, overallPace: { type: "string", enum: ["relaxed", "balanced", "active"] },
    tripStrategy: { type: "object", additionalProperties: false,
      required: ["geographicApproach", "experienceProgression", "avoidRepeatedVisitContexts"],
      properties: { geographicApproach: { type: "string" }, experienceProgression: { type: "string" },
        avoidRepeatedVisitContexts: { type: "boolean" } } },
    days: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["dayIndex", "purpose", "density", "geographicFocus", "experienceBlocks"],
      properties: { dayIndex: { type: "integer" }, purpose: { type: "string" },
        density: { type: "string", enum: ["light", "balanced", "full"] },
        geographicFocus: { type: ["string", "null"] },
        experienceBlocks: { type: "array", items: { type: "object", additionalProperties: false,
          required: ["purpose", "primaryExperience", "visitContext", "supportingNeeds", "qualitativeNeeds", "repeatJustification"],
          properties: { purpose: { type: "string" }, primaryExperience: { type: "string" },
            visitContext: { type: "string" },
            supportingNeeds: { type: "array", items: { type: "string", enum: ["meal", "cafe", "rest", "shopping"] } },
            qualitativeNeeds: { type: "array", items: qualitySchema },
            repeatJustification: { type: ["string", "null"] },
          } } },
      } } },
    requiredElements: { type: "array", items: { type: "string", enum: activityIds } },
    optionalElements: { type: "array", items: { type: "string", enum: activityIds } },
    qualitativeNeeds: { type: "array", items: qualitySchema },
    uncertainties: { type: "array", items: { type: "string" } },
  },
};

export type ExperiencePlanInput = { message: string; objective: string; days: number;
  pace: AIPlannerState["pace"]; hardConstraints: DateContext["hardConstraints"];
  activitySignals: ActivityRequirement[]; qualitativeNeeds: ExperienceQuality[];
  semanticPreferences: Array<{ dimension: string; value: string }>;
  timeWindow: { startTime: string | null; endTime: string | null;
    dayWindows: Record<number, { start?: string; end?: string }> };
  sessionFeedback: Array<{ attribute: string; sentiment: string }> };

/** Narrow model input. Existing search, candidate and route data never enter this stage. */
export function buildExperiencePlanInput(message: string, state: AIPlannerState,
  context: Pick<DateContext, "hardConstraints" | "effectiveUnderstanding" | "sessionFeedback">): ExperiencePlanInput {
  const days = Math.max(1, state.nights + 1);
  const direct: ExperienceQuality[] = [];
  const add = (category: ExperienceQuality["category"], dimension: ExperienceQuality["dimension"]) => {
    if (!direct.some(item => item.category === category && item.dimension === dimension))
      direct.push({ category, dimension, source: "explicit_user" });
  };
  if (/(?:예쁜|이쁜|감성)\s*카페|카페.{0,8}(?:예쁜|이쁜|감성)/.test(message)) add("cafe", "aesthetic");
  if (/조용한?\s*카페|카페.{0,8}조용/.test(message)) add("cafe", "quiet");
  if (/(?:뷰\s*좋은|전망\s*좋은|오션뷰)\s*카페|카페.{0,8}(?:뷰|전망)/.test(message)) add("cafe", "scenic");
  if (/분위기\s*좋은\s*(?:식당|레스토랑)|(?:식당|레스토랑).{0,8}분위기/.test(message)) add("meal", "atmosphere");
  if (/한옥\s*카페|카페.{0,8}한옥/.test(message)) add("cafe", "hanok");
  if (/전통(?:적인)?\s*(?:카페|식당)|(?:카페|식당).{0,8}전통/.test(message)) add("any", "traditional");
  if (/넓은\s*(?:카페|식당)|(?:카페|식당).{0,8}넓/.test(message)) add("any", "spacious");
  if (/로맨틱|데이트다운/.test(message)) add("any", "romantic");
  const approved = (context.effectiveUnderstanding?.semanticPreferences ?? [])
    .filter(item => item.source === "llm" && item.confidence >= 0.75)
    .flatMap(item => {
      const dimension: ExperienceQuality["dimension"] | null = item.dimension === "noise" ? "quiet"
        : item.dimension === "atmosphere" ? "atmosphere" : null;
      return dimension ? [{ category: "any" as const, dimension, source: "approved_semantic" as const }] : [];
    });
  // The orchestration snapshot may precede the state update that appends this
  // turn to userRequests. Ground provenance and trip windows in the turn itself.
  const turnState = { ...state, userRequests: [...(state.userRequests ?? []), message] };
  const activitySignals = resolveRequiredActivities(turnState);
  const hardConstraints = { ...context.hardConstraints,
    requiredActivities: activitySignals.filter(item => item.explicit).map(item => item.activity) };
  return { message: message.slice(0, 800), objective: state.objective ?? message.slice(0, 120), days,
    pace: state.pace, hardConstraints, activitySignals,
    qualitativeNeeds: [...direct, ...approved.filter(item => !direct.some(value => value.category === item.category && value.dimension === item.dimension))],
    semanticPreferences: (context.effectiveUnderstanding?.semanticPreferences ?? [])
      .filter(item => item.source === "llm" && item.confidence >= 0.75)
      .map(item => ({ dimension: item.dimension, value: item.value })).slice(0, 8),
    timeWindow: { startTime: state.startTime, endTime: state.endTime,
      dayWindows: tripLocalWindows(turnState.userRequests, days) },
    sessionFeedback: (context.sessionFeedback?.entries ?? []).slice(-6)
      .map(item => ({ attribute: item.attribute, sentiment: item.sentiment })),
  };
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const short = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const experienceIds = new Set<string>(activityIds);
const qualities = new Set(["aesthetic", "atmosphere", "quiet", "scenic", "view", "romantic", "spacious", "traditional", "hanok"]);
const qualityKey = (quality: ExperienceQuality) => `${quality.category}:${quality.dimension}:${quality.source}`;
const validQuality = (value: unknown): value is ExperienceQuality => record(value)
  && exactKeys(value, ["category", "dimension", "source"])
  && ["cafe", "meal", "any"].includes(String(value.category))
  && qualities.has(String(value.dimension)) && ["explicit_user", "approved_semantic"].includes(String(value.source));

/** Reject model-added hard requirements, venue IDs/names, unsupported qualities,
 * repeated visit contexts across trip days, and implausible day windows. */
export function validateExperiencePlan(raw: unknown, input: ExperiencePlanInput): ExperiencePlan | null {
  if (!record(raw) || !exactKeys(raw, ["objective", "overallPace", "tripStrategy", "days", "requiredElements",
    "optionalElements", "qualitativeNeeds", "uncertainties"])
    || !short(raw.objective) || !["relaxed", "balanced", "active"].includes(String(raw.overallPace))
    || !record(raw.tripStrategy)
    || !exactKeys(raw.tripStrategy, ["geographicApproach", "experienceProgression", "avoidRepeatedVisitContexts"])
    || !short(raw.tripStrategy.geographicApproach)
    || !short(raw.tripStrategy.experienceProgression)
    || typeof raw.tripStrategy.avoidRepeatedVisitContexts !== "boolean"
    || !Array.isArray(raw.days) || raw.days.length !== input.days
    || !Array.isArray(raw.requiredElements) || !Array.isArray(raw.optionalElements)
    || !Array.isArray(raw.qualitativeNeeds) || !Array.isArray(raw.uncertainties)) return null;
  const requiredElements = raw.requiredElements as unknown[];
  const optionalElements = raw.optionalElements as unknown[];
  const qualitativeNeeds = raw.qualitativeNeeds as unknown[];
  const required = input.activitySignals.filter(item => item.explicit).map(item => item.activity);
  if (requiredElements.length !== required.length || !required.every(item => requiredElements.includes(item))
    || optionalElements.some(item => !experienceIds.has(String(item)) || required.includes(item as DateActivityId))
    || !qualitativeNeeds.every(validQuality) || raw.uncertainties.some(item => typeof item !== "string" || item.length > 160)) return null;
  const allowedQualities = new Set(input.qualitativeNeeds.map(qualityKey));
  if (qualitativeNeeds.some(item => !allowedQualities.has(qualityKey(item as ExperienceQuality)))) return null;
  if (input.qualitativeNeeds.some(item => item.source === "explicit_user"
    && !qualitativeNeeds.some(other => qualityKey(other as ExperienceQuality) === qualityKey(item)))) return null;
  const seenContexts = new Map<string, number>();
  const seenPurposes = new Set<string>();
  const days: ExperienceDayPlan[] = [];
  const oneBasedDays = raw.days.every((day, index) => record(day) && day.dayIndex === index + 1);
  const zeroBasedDays = raw.days.every((day, index) => record(day) && day.dayIndex === index);
  if (!oneBasedDays && !zeroBasedDays) return null;
  const banned = [...input.hardConstraints.requiredPlaces, ...input.hardConstraints.excludedPlaces]
    .filter(name => name.length >= 2);
  if (/(?:kakao|tourapi|naver|candidate|venue):[^\s"}]+/i.test(JSON.stringify(raw))) return null;
  const usedQualities = new Set<string>();
  for (let index = 0; index < raw.days.length; index++) {
    const day = raw.days[index];
    if (!record(day) || !exactKeys(day, ["dayIndex", "purpose", "density", "geographicFocus", "experienceBlocks"])
      || !short(day.purpose)
      || !["light", "balanced", "full"].includes(String(day.density))
      || !(day.geographicFocus === null || short(day.geographicFocus))
      || !Array.isArray(day.experienceBlocks) || day.experienceBlocks.length < 1 || day.experienceBlocks.length > 5) return null;
    const dayPurpose = String(day.purpose).trim().toLowerCase();
    if (input.days > 1 && seenPurposes.has(dayPurpose)) return null;
    seenPurposes.add(dayPurpose);
    const blocks: ExperienceBlock[] = [];
    for (const block of day.experienceBlocks) {
      if (!record(block) || !exactKeys(block, ["purpose", "primaryExperience", "visitContext", "supportingNeeds",
        "qualitativeNeeds", "repeatJustification"])
        || !short(block.purpose) || !short(block.primaryExperience)
        || !short(block.visitContext) || !Array.isArray(block.supportingNeeds)
        || block.supportingNeeds.some(item => !["meal", "cafe", "rest", "shopping"].includes(String(item)))
        || !Array.isArray(block.qualitativeNeeds) || block.qualitativeNeeds.some(item => !validQuality(item)
          || !allowedQualities.has(qualityKey(item)))
        || !(block.repeatJustification === null || short(block.repeatJustification))) return null;
      const prose = `${block.purpose} ${block.primaryExperience} ${block.visitContext}`;
      if (/(?:kakao|tourapi|naver|candidate|venue):[^\s]+/i.test(prose)
        || banned.some(name => prose.includes(name))) return null;
      const key = String(block.visitContext).trim().toLowerCase();
      if (seenContexts.has(key) && seenContexts.get(key) !== index && !block.repeatJustification) return null;
      seenContexts.set(key, index);
      block.qualitativeNeeds.forEach((item: ExperienceQuality) => usedQualities.add(qualityKey(item)));
      blocks.push(block as ExperienceBlock);
    }
    days.push({ ...day, dayIndex: index, experienceBlocks: blocks } as ExperienceDayPlan);
  }
  if (input.qualitativeNeeds.some(item => item.source === "explicit_user"
    && !usedQualities.has(qualityKey(item)))) return null;
  return { ...raw, days } as ExperiencePlan;
}

/** Recheck a client-carried P2 plan at the server-action boundary. Its contents
 * remain planning context; required activities come from the current brief. */
export function validateExperiencePlanHandoff(raw: unknown, input: {
  days: number; pace: AIPlannerState["pace"]; requiredElements: DateActivityId[];
  requiredPlaces: string[]; excludedPlaces: string[];
}): ExperiencePlan | null {
  if (!record(raw) || raw.overallPace !== input.pace
    || !Array.isArray(raw.requiredElements)
    || raw.requiredElements.some(item => !experienceIds.has(String(item)))
    || !Array.isArray(raw.qualitativeNeeds)) return null;
  return validateExperiencePlan(raw, {
    message: "", objective: "", days: input.days, pace: input.pace,
    hardConstraints: { requiredPlaces: input.requiredPlaces,
      excludedPlaces: input.excludedPlaces } as ExperiencePlanInput["hardConstraints"],
    activitySignals: input.requiredElements.map(activity => ({ activity,
      origin: "explicit_constraint", explicit: true })),
    qualitativeNeeds: raw.qualitativeNeeds as ExperienceQuality[],
    semanticPreferences: [], timeWindow: { startTime: null, endTime: null, dayWindows: {} },
    sessionFeedback: [],
  });
}

export type ExperiencePlanComparison = { plannedDensities: ExperienceDensity[];
  legacyMinStops: number; legacySpine: DateActivityId[];
  plannedExperienceCount: number; supportingMealOrCafeCount: number;
  potentialSpineConflict: boolean; supportingSlotConflict: boolean;
  potentialRewriteConflicts: string[];
  densityWindowWarnings: number[]; paceWarning: boolean;
  legacyRewriteStages: string[] };

/** Diagnostics only: this never changes model proposal, search or fallback. */
export function compareExperiencePlanToLegacy(plan: ExperiencePlan, state: AIPlannerState,
  rewriteStages: string[] = [], message = state.userRequests?.at(-1) ?? ""): ExperiencePlanComparison {
  const spine = dateSpine(state);
  const primary = plan.days.flatMap(day => day.experienceBlocks.map(block => block.primaryExperience.toLowerCase()));
  const support = plan.days.flatMap(day => day.experienceBlocks.flatMap(block => block.supportingNeeds));
  const words: Partial<Record<DateActivityId, RegExp>> = { meal: /식사|음식|맛집|레스토랑|meal|food/,
    cafe: /카페|커피|cafe/, walk: /산책|걷|해변|공원|walk/, exhibit: /전시|미술관|exhibit/ };
  const potentialSpineConflict = spine.some(slot => Boolean(words[slot])
    && !primary.some(value => words[slot]!.test(value)) && !support.includes(slot as ExperienceSupport));
  const supportingSlotConflict = spine.some(slot => (slot === "meal" || slot === "cafe")
    && support.includes(slot) && !primary.some(value => words[slot]!.test(value)));
  const windows = tripLocalWindows([...(state.userRequests ?? []), message], plan.days.length);
  const densityWindowWarnings = plan.days.filter(day => day.density !== "light"
    && (Boolean(windows[day.dayIndex]?.start && windows[day.dayIndex].start! >= "18:00")
      || Boolean(windows[day.dayIndex]?.end && windows[day.dayIndex].end! <= "15:00")))
    .map(day => day.dayIndex);
  return { plannedDensities: plan.days.map(day => day.density), legacyMinStops: courseSize(state).min,
    legacySpine: spine, plannedExperienceCount: primary.length,
    supportingMealOrCafeCount: support.filter(item => item === "meal" || item === "cafe").length,
    potentialSpineConflict, supportingSlotConflict,
    potentialRewriteConflicts: [
      ...(primary.length < courseSize(state).min ? ["legacy_minimum_fill"] : []),
      ...(potentialSpineConflict || supportingSlotConflict ? ["legacy_activity_spine"] : []),
    ],
    densityWindowWarnings,
    paceWarning: /(?:여유|느긋|천천|휴양)/.test(message) && plan.overallPace !== "relaxed",
    legacyRewriteStages: [...rewriteStages],
  };
}
