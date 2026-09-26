import type { AIChatStop, AIPlannerReply } from "@/features/planning/types/plan";
import type { DateIntent } from "./dateIntent";
import type {
  DateFeedback, DateGoal, DateGoalType, DateReference, DateReferenceKind,
  DateRequestedChange, DateTurnUnderstanding, SemanticPreference,
} from "./dateTurnUnderstanding";

const goalTypes: DateGoalType[] = ["create_itinerary", "modify_itinerary", "recommend_places", "ask_venue",
  "compare_places", "explain_recommendation", "save_itinerary", "provide_feedback", "general_chat"];
const referenceKinds: DateReferenceKind[] = ["current_place", "current_plan_item", "previous_place",
  "ordinal_place", "category_slot", "unresolved"];
const operations: DateRequestedChange["operation"][] = ["add", "remove", "replace", "reorder", "retime", "keep"];
const sentiments = ["positive", "negative"] as const;
const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const stringArray = { type: "array", items: { type: "string" } };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties,
  required: Object.keys(properties), additionalProperties: false });
const array = (items: Record<string, unknown>) => ({ type: "array", items });

/** Strict provider schema. Claims about hard constraints are diagnostics, never authority. */
export const dateTurnPayloadSchema = object({
  goals: array(object({ type: { type: "string", enum: goalTypes }, targetText: nullableString,
    attribute: nullableString, confidence: { type: "number", minimum: 0, maximum: 1 } })),
  references: array(object({ text: { type: "string" }, kind: { type: "string", enum: referenceKinds },
    proposedName: nullableString, proposedId: nullableString, ordinal: { type: ["integer", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 } })),
  semanticPreferences: array(object({ dimension: { type: "string" }, value: { type: "string" },
    sentiment: { type: ["string", "null"], enum: [...sentiments, null] },
    strength: nullableNumber, confidence: { type: "number", minimum: 0, maximum: 1 },
    evidenceText: { type: "string" } })),
  requestedChanges: array(object({ operation: { type: "string", enum: operations }, targetText: nullableString,
    replacementPreference: nullableString, explicitValue: nullableString,
    confidence: { type: "number", minimum: 0, maximum: 1 } })),
  feedback: array(object({ targetText: nullableString, attribute: nullableString,
    sentiment: { type: "string", enum: sentiments }, strength: nullableNumber,
    evidenceText: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 } })),
  constraintClaims: object({ areas: stringArray, date: nullableString, startTime: nullableString,
    endTime: nullableString, budgetWon: nullableNumber, requiredPlaces: stringArray,
    excludedPlaces: stringArray, excludedFoods: stringArray, requiredActivities: stringArray }),
  ambiguities: stringArray,
  confidence: { type: "number", minimum: 0, maximum: 1 },
});

export type DateTurnPayload = {
  goals: Array<{ type: DateGoalType; targetText: string | null; attribute: string | null; confidence: number }>;
  references: Array<{ text: string; kind: DateReferenceKind; proposedName: string | null;
    proposedId: string | null; ordinal: number | null; confidence: number }>;
  semanticPreferences: Array<{ dimension: string; value: string; sentiment: "positive" | "negative" | null;
    strength: number | null; confidence: number; evidenceText: string }>;
  requestedChanges: Array<{ operation: DateRequestedChange["operation"]; targetText: string | null;
    replacementPreference: string | null; explicitValue: string | null; confidence: number }>;
  feedback: Array<{ targetText: string | null; attribute: string | null; sentiment: "positive" | "negative";
    strength: number | null; evidenceText: string; confidence: number }>;
  constraintClaims: { areas: string[]; date: string | null; startTime: string | null; endTime: string | null;
    budgetWon: number | null; requiredPlaces: string[]; excludedPlaces: string[];
    excludedFoods: string[]; requiredActivities: string[] };
  ambiguities: string[];
  confidence: number;
};

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length && expected.every(key => key in value);
const string = (value: unknown): value is string => typeof value === "string" && value.length <= 300;
const optionalString = (value: unknown): value is string | null => value === null || string(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const confidence = (value: unknown): value is number => number(value) && value >= 0 && value <= 1;
const strength = (value: unknown): value is number | null => value === null || confidence(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 12 && value.every(string);
const rows = (value: unknown, valid: (row: Record<string, unknown>) => boolean, limit: number) =>
  Array.isArray(value) && value.length <= limit && value.every(item => record(item) && valid(item));

/** Provider schema enforcement does not replace this application boundary. */
export function validateDateTurnPayload(value: unknown): DateTurnPayload | null {
  if (!record(value) || !keys(value, ["goals", "references", "semanticPreferences", "requestedChanges",
    "feedback", "constraintClaims", "ambiguities", "confidence"])) return null;
  const claims = value.constraintClaims;
  if (!record(claims) || !keys(claims, ["areas", "date", "startTime", "endTime", "budgetWon",
    "requiredPlaces", "excludedPlaces", "excludedFoods", "requiredActivities"])) return null;
  if (!rows(value.goals, row => keys(row, ["type", "targetText", "attribute", "confidence"])
    && goalTypes.includes(row.type as DateGoalType) && optionalString(row.targetText)
    && optionalString(row.attribute) && confidence(row.confidence), 12)) return null;
  if (!rows(value.references, row => keys(row, ["text", "kind", "proposedName", "proposedId", "ordinal", "confidence"])
    && string(row.text) && referenceKinds.includes(row.kind as DateReferenceKind)
    && optionalString(row.proposedName) && optionalString(row.proposedId)
    && (row.ordinal === null || (Number.isInteger(row.ordinal) && Number(row.ordinal) >= 1 && Number(row.ordinal) <= 30))
    && confidence(row.confidence), 12)) return null;
  if (!rows(value.semanticPreferences, row => keys(row, ["dimension", "value", "sentiment", "strength", "confidence", "evidenceText"])
    && string(row.dimension) && string(row.value) && (row.sentiment === null || sentiments.includes(row.sentiment as typeof sentiments[number]))
    && strength(row.strength) && confidence(row.confidence) && string(row.evidenceText), 12)) return null;
  if (!rows(value.requestedChanges, row => keys(row, ["operation", "targetText", "replacementPreference", "explicitValue", "confidence"])
    && operations.includes(row.operation as DateRequestedChange["operation"])
    && optionalString(row.targetText) && optionalString(row.replacementPreference)
    && optionalString(row.explicitValue) && confidence(row.confidence), 12)) return null;
  if (!rows(value.feedback, row => keys(row, ["targetText", "attribute", "sentiment", "strength", "evidenceText", "confidence"])
    && optionalString(row.targetText) && optionalString(row.attribute)
    && sentiments.includes(row.sentiment as typeof sentiments[number]) && strength(row.strength)
    && string(row.evidenceText) && confidence(row.confidence), 12)) return null;
  if (!strings(claims.areas) || !optionalString(claims.date) || !optionalString(claims.startTime)
    || !optionalString(claims.endTime) || !(claims.budgetWon === null || number(claims.budgetWon))
    || !strings(claims.requiredPlaces) || !strings(claims.excludedPlaces)
    || !strings(claims.excludedFoods) || !strings(claims.requiredActivities)
    || !strings(value.ambiguities) || !confidence(value.confidence)) return null;
  return value as DateTurnPayload;
}

const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const same = (left: string, right: string) => compact(left) === compact(right);
type Place = { name: string; placeId?: string; activitySlot?: string; category?: string };

function verifiedReference(input: { text: string; kind: DateReferenceKind; ordinal: number | null; confidence: number },
  message: string, plan: AIPlannerReply | null, visible: Array<AIChatStop | string>, legacy: DateTurnUnderstanding): DateReference | null {
  const text = input.text.trim();
  if (!text || !compact(message).includes(compact(text))) return null;
  const known = legacy.references.find(reference => same(reference.text, text) && reference.resolvedName);
  if (known && input.kind !== "ordinal_place") return known;
  const planPlaces: Place[] = plan?.items.length
    ? [...plan.items].sort((a, b) => a.dayIndex - b.dayIndex || a.order - b.order)
      .map(item => plan.recommendations.find(place => place.placeId === item.placeId)
        ?? { name: item.placeName, placeId: item.placeId, category: item.category })
    : plan?.recommendations ?? [];
  const shown: Place[] = visible.map(place => typeof place === "string" ? { name: place } : { name: place.name });
  let matches: Place[] = [];
  if (input.kind === "ordinal_place") {
    const writtenOrdinal = text.match(/\d+/)?.[0] ?? (text.includes("첫") ? "1" : text.includes("두") ? "2" : text.includes("세") ? "3" : null);
    const ordinal = writtenOrdinal ? Number(writtenOrdinal) : input.ordinal;
    if (ordinal && !(planPlaces.length && shown.length)) matches = [planPlaces.length ? planPlaces[ordinal - 1] : shown[ordinal - 1]].filter(Boolean);
  } else if (input.kind === "category_slot") {
    const slot = /카페/.test(text) ? "cafe" : /저녁|점심|아침|식당/.test(text) ? "meal" : null;
    if (slot) matches = planPlaces.filter(place => place.activitySlot === slot
      || (!place.activitySlot && (slot === "cafe" ? /카페/ : /식당|음식|맛집/).test(place.category ?? "")));
  } else {
    matches = [...planPlaces, ...shown].filter(place => same(place.name, text));
    if (!matches.length && /여기|거기|저기/.test(text)) {
      const unique = [...new Map([...planPlaces, ...shown].map(place => [compact(place.name), place])).values()];
      if (unique.length === 1) matches = unique;
    }
  }
  if (matches.length !== 1) return { text, kind: "unresolved", confidence: Math.min(input.confidence, 0.4) };
  const place = matches[0];
  return { text, kind: input.kind, resolvedId: place.placeId, resolvedName: place.name,
    targetType: planPlaces.some(item => item.placeId === place.placeId && Boolean(place.placeId)) ? "plan_item" : "place",
    confidence: Math.min(input.confidence, 0.95) };
}

/** Normalize validated semantic output. Model hard-constraint claims and IDs are deliberately not copied. */
export function normalizeDateTurnPayload(payload: DateTurnPayload, input: {
  message: string; currentPlan?: AIPlannerReply | null; visiblePlaces?: Array<AIChatStop | string>;
  legacy: DateTurnUnderstanding;
}): DateTurnUnderstanding {
  const references = payload.references.flatMap(reference => {
    const verified = verifiedReference(reference, input.message, input.currentPlan ?? null,
      input.visiblePlaces ?? [], input.legacy);
    return verified ? [verified] : [];
  });
  const target = (text: string | null) => {
    if (!text) return undefined;
    const candidates = [...references, ...input.legacy.references].filter(reference => same(reference.text, text));
    return candidates.find(reference => reference.resolvedName) ?? candidates[0]
      ?? (compact(input.message).includes(compact(text))
        ? { text, kind: "unresolved" as const, confidence: 0.3 } : undefined);
  };
  const goals: DateGoal[] = payload.goals.map(goal => ({ type: goal.type,
    target: target(goal.targetText), attribute: goal.attribute?.trim() || undefined, confidence: goal.confidence }));
  const semanticPreferences: SemanticPreference[] = payload.semanticPreferences.map(preference => ({
    dimension: preference.dimension.trim().slice(0, 50), value: preference.value.trim().slice(0, 120),
    sentiment: (preference.sentiment ?? "neutral") as SemanticPreference["sentiment"],
    strength: preference.strength ?? preference.confidence,
    confidence: preference.confidence, evidenceText: preference.evidenceText.trim().slice(0, 120), source: "llm" as const,
  })).filter(preference => preference.dimension && preference.value);
  const requestedChanges: DateRequestedChange[] = payload.requestedChanges.map(change => ({
    operation: change.operation, target: target(change.targetText),
    replacementPreference: change.replacementPreference ? semanticPreferences.find(preference =>
      same(preference.value, change.replacementPreference!)) : undefined,
    explicitValue: change.explicitValue && compact(input.message).includes(compact(change.explicitValue))
      ? change.explicitValue.trim() : undefined,
    confidence: change.confidence,
  }));
  const feedback: DateFeedback[] = payload.feedback.map(item => ({ target: target(item.targetText),
    attribute: item.attribute?.trim() || undefined, sentiment: item.sentiment,
    strength: item.strength ?? item.confidence, confidence: item.confidence,
    evidenceText: item.evidenceText.trim().slice(0, 120), explicit: true,
  })).filter(item => item.evidenceText && compact(input.message).includes(compact(item.evidenceText)));
  const ambiguities = [...new Set([...payload.ambiguities.map(value => value.trim()),
    ...references.filter(reference => reference.kind === "unresolved").map(reference => reference.text)])].filter(Boolean);
  return { rawMessage: input.message, goals, references, explicitConstraints: {}, semanticPreferences,
    requestedChanges, feedback, ambiguities,
    confidence: ambiguities.length ? Math.min(payload.confidence, 0.54) : payload.confidence,
    provenance: [
      ...goals.map(goal => ({ field: "goals" as const, source: "llm" as const, key: goal.type })),
      ...references.map(reference => ({ field: "references" as const,
        source: reference.resolvedName ? "existing_state" as const : "llm" as const, key: reference.kind })),
      ...semanticPreferences.map(preference => ({ field: "semanticPreferences" as const, source: "llm" as const, key: preference.dimension })),
      ...requestedChanges.map(change => ({ field: "requestedChanges" as const, source: "llm" as const, key: change.operation })),
      ...feedback.map(item => ({ field: "feedback" as const, source: "llm" as const, key: item.attribute })),
    ] };
}

/** Authority: explicit deterministic facts > verified state > LLM semantics > legacy heuristics > unresolved. */
export function mergeDateTurnUnderstanding(legacy: DateTurnUnderstanding, llm: DateTurnUnderstanding): DateTurnUnderstanding {
  const verified = [...legacy.references, ...llm.references].filter(reference => reference.resolvedName);
  const references = [...verified, ...llm.references, ...legacy.references].filter((reference, index, all) =>
    all.findIndex(item => same(item.text, reference.text)) === index);
  const preferred = llm.semanticPreferences.filter(item => item.confidence >= 0.45);
  const semanticPreferences = [...preferred, ...legacy.semanticPreferences.filter(item =>
    !preferred.some(other => other.dimension === item.dimension))];
  const llmGoals = llm.goals.filter(goal => goal.confidence >= 0.45);
  const llmChanges = llm.requestedChanges.filter(change => change.confidence >= 0.45);
  const ambiguities = [...new Set([...legacy.ambiguities, ...llm.ambiguities])];
  return { ...legacy, goals: llmGoals.length ? llmGoals : legacy.goals, references,
    explicitConstraints: { ...legacy.explicitConstraints }, semanticPreferences,
    requestedChanges: llmChanges.length ? llmChanges : legacy.requestedChanges,
    feedback: llm.feedback.length ? llm.feedback : legacy.feedback, ambiguities,
    confidence: llmGoals.length ? llm.confidence : legacy.confidence,
    provenance: [...legacy.provenance, ...llm.provenance] };
}

export type UnderstandingComparison = {
  goalAgreement: { shared: DateGoalType[]; legacyOnly: DateGoalType[]; llmOnly: DateGoalType[]; refinement: boolean };
  constraintConflicts: Array<keyof DateIntent["hardConstraints"]>;
  semanticDifferences: string[];
  referenceDifferences: number;
  invalidReferenceProposals: number;
  feedbackDifferences: string[];
  ambiguities: { legacy: number; llm: number };
};

/** Compare semantic structure; raw message and venue names are excluded from diagnostics. */
export function compareDateTurnUnderstanding(legacy: DateTurnUnderstanding, llm: DateTurnUnderstanding,
  claims: DateTurnPayload["constraintClaims"], proposals: DateTurnPayload["references"] = []): UnderstandingComparison {
  const legacyGoals = [...new Set(legacy.goals.map(goal => goal.type))];
  const llmGoals = [...new Set(llm.goals.map(goal => goal.type))];
  const claimValue = (key: keyof DateIntent["hardConstraints"]) => claims[key];
  const constraintConflicts = (Object.keys(legacy.explicitConstraints) as Array<keyof DateIntent["hardConstraints"]>)
    .filter(key => {
      const claimed = claimValue(key);
      if (claimed === null || (Array.isArray(claimed) && !claimed.length)) return false;
      const actual = legacy.explicitConstraints[key];
      return JSON.stringify(Array.isArray(actual) ? [...actual].sort() : actual)
        !== JSON.stringify(Array.isArray(claimed) ? [...claimed].sort() : claimed);
    });
  const preferenceKeys = (turn: DateTurnUnderstanding) => new Set(turn.semanticPreferences.map(item =>
    `${item.dimension}:${compact(item.value)}`));
  const legacyPreferences = preferenceKeys(legacy);
  const llmPreferences = preferenceKeys(llm);
  const feedbackKeys = (turn: DateTurnUnderstanding) => new Set(turn.feedback.map(item =>
    `${item.attribute ?? "overall"}:${item.sentiment}`));
  const legacyFeedback = feedbackKeys(legacy);
  const llmFeedback = feedbackKeys(llm);
  const symmetric = (a: Set<string>, b: Set<string>) => [...new Set([...a, ...b].filter(item => !a.has(item) || !b.has(item)))];
  const legacyRefs = new Map(legacy.references.map(reference => [compact(reference.text), reference]));
  const llmRefs = new Map(llm.references.map(reference => [compact(reference.text), reference]));
  const referenceDifferences = [...new Set([...legacyRefs.keys(), ...llmRefs.keys()])].filter(key => {
    const before = legacyRefs.get(key);
    const after = llmRefs.get(key);
    return !before || !after || before.kind !== after.kind
      || (before.resolvedId ?? before.resolvedName ?? null) !== (after.resolvedId ?? after.resolvedName ?? null);
  }).length;
  const invalidReferenceProposals = proposals.filter(proposal => {
    const verified = llmRefs.get(compact(proposal.text));
    return (Boolean(proposal.proposedId) && proposal.proposedId !== verified?.resolvedId)
      || (Boolean(proposal.proposedName) && !same(proposal.proposedName!, verified?.resolvedName ?? ""));
  }).length;
  return { goalAgreement: { shared: legacyGoals.filter(type => llmGoals.includes(type)),
    legacyOnly: legacyGoals.filter(type => !llmGoals.includes(type)),
    llmOnly: llmGoals.filter(type => !legacyGoals.includes(type)),
    refinement: legacyGoals.length === 1 && llmGoals.length > 1 && llmGoals.includes(legacyGoals[0]) },
  constraintConflicts, semanticDifferences: symmetric(legacyPreferences, llmPreferences),
  referenceDifferences, invalidReferenceProposals,
  feedbackDifferences: symmetric(legacyFeedback, llmFeedback),
  ambiguities: { legacy: legacy.ambiguities.length, llm: llm.ambiguities.length } };
}
