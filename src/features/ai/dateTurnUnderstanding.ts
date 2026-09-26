import type { AIChatStop, AIPlannerReply, AIPlannerState, DateChatTurn } from "@/features/planning/types/plan";
import type { DateContext } from "./dateContext";
import type { ChatRoute } from "./chatRoute";
import { isPlaceRequest, isQuestion } from "./chatRoute";
import { extractActivitiesFromText, extractAreasFromText, extractPlacesFromText } from "./dateBrief";
import { isSwapRequest } from "./dateCourse";
import { explicitDateConstraints } from "./dateConstraints";
import { deriveDateUnderstanding, explicitFoodExclusions, type DateIntent } from "./dateIntent";
import { resolveSessionRejectedReference, resolveSessionShownReference,
  type SessionCandidateContext } from "./sessionCandidates";

export type DateGoalType = "create_itinerary" | "modify_itinerary" | "recommend_places"
  | "ask_venue" | "compare_places" | "explain_recommendation" | "save_itinerary"
  | "provide_feedback" | "general_chat";
export type DateReferenceKind = "current_place" | "current_plan_item" | "previous_place"
  | "ordinal_place" | "category_slot" | "unresolved";
export type DateProvenanceSource = "deterministic" | "llm" | "legacy_route"
  | "legacy_heuristic" | "existing_state" | "conversation_reference" | "unknown";

export type DateReference = {
  text: string;
  kind: DateReferenceKind;
  resolvedId?: string;
  resolvedName?: string;
  targetType?: "place" | "plan_item" | "plan";
  confidence: number;
};
export type DateGoal = {
  type: DateGoalType;
  target?: DateReference;
  attribute?: string;
  confidence: number;
};
export type SemanticPreference = {
  dimension: string;
  value: string;
  sentiment: "positive" | "negative" | "neutral";
  strength: number;
  confidence: number;
  evidenceText: string;
  source: DateProvenanceSource;
};
export type DateRequestedChange = {
  operation: "add" | "remove" | "replace" | "reorder" | "retime" | "keep";
  target?: DateReference;
  replacementPreference?: SemanticPreference;
  explicitValue?: string | number;
  confidence: number;
};
export type DateFeedback = {
  target?: DateReference;
  attribute?: string;
  sentiment: "positive" | "negative";
  strength: number;
  confidence: number;
  evidenceText: string;
  explicit: boolean;
  /** Set to llm only after the assist approval gate; legacy feedback has no source here. */
  source?: DateProvenanceSource;
};
export type DateUnderstandingProvenance = {
  field: "goals" | "references" | "explicitConstraints" | "semanticPreferences" | "requestedChanges" | "feedback";
  source: DateProvenanceSource;
  key?: string;
};
export type DateTurnUnderstanding = {
  rawMessage: string;
  goals: DateGoal[];
  references: DateReference[];
  explicitConstraints: Partial<DateIntent["hardConstraints"]>;
  semanticPreferences: SemanticPreference[];
  requestedChanges: DateRequestedChange[];
  feedback: DateFeedback[];
  ambiguities: string[];
  confidence: number;
  provenance: DateUnderstandingProvenance[];
};

type VisiblePlace = AIChatStop | string;
type Input = {
  message: string;
  today: string;
  state: AIPlannerState;
  context?: DateContext | null;
  sessionCandidates?: SessionCandidateContext | null;
  conversation?: DateChatTurn[];
  currentPlan?: AIPlannerReply | null;
  visiblePlaces?: VisiblePlace[];
  legacyRoute?: ChatRoute | null;
  interpretedIntent?: DateIntent | null;
  /** The legacy interpreter does not currently report this, so unknown is the default. */
  interpretedSource?: DateProvenanceSource;
};

const compact = (value: string) => value.replace(/\s/g, "").toLowerCase();
const clauseParts = (message: string) => message.split(/(?<=[.!?])\s*|\s*그리고\s*/)
  .map(part => part.trim()).filter(Boolean);

function referenceToPlace(text: string, kind: DateReferenceKind,
  place: { placeId?: string; name: string } | undefined, targetType: DateReference["targetType"]): DateReference {
  return place ? { text, kind, resolvedId: place.placeId, resolvedName: place.name, targetType, confidence: 0.95 }
    : { text, kind: "unresolved", targetType, confidence: 0.3 };
}

function resolveReferences(message: string, plan: AIPlannerReply | null, visible: VisiblePlace[]): DateReference[] {
  const sources: Array<{ text: string; kind: DateReferenceKind; start: number; slot?: "meal" | "cafe"; ordinal?: number; targetType?: DateReference["targetType"] }> = [];
  const add = (pattern: RegExp, kind: DateReferenceKind, extra?: { slot?: "meal" | "cafe"; targetType?: DateReference["targetType"] }) => {
    for (const match of message.matchAll(pattern)) sources.push({ text: match[0], kind, start: match.index, ...extra });
  };
  for (const match of message.matchAll(/(?:([1-9]\d*)|첫|두|세)\s*번째\s*(?:장소|곳|코스)?/g)) {
    const word = match[0].replace(/\s/g, "");
    const ordinal = match[1] ? Number(match[1]) : word.startsWith("첫") ? 1 : word.startsWith("두") ? 2 : 3;
    sources.push({ text: match[0], kind: "ordinal_place", start: match.index, ordinal,
      targetType: /코스/.test(match[0]) ? "plan" : "plan_item" });
  }
  add(/(?:지금|이|그)\s*카페/g, "category_slot", { slot: "cafe", targetType: "plan_item" });
  add(/(?:지금|이|그)\s*식당/g, "category_slot", { slot: "meal", targetType: "plan_item" });
  add(/저녁|점심|아침/g, "category_slot", { slot: "meal", targetType: "plan_item" });
  add(/아까\s*(?:게|거|것)|전에\s*추천한\s*곳/g, "previous_place", { targetType: "plan" });
  add(/여기|거기/g, "unresolved", { targetType: "place" });
  for (const place of plan?.recommendations ?? []) {
    if (place.name.length < 2) continue;
    const start = message.indexOf(place.name);
    if (start >= 0) sources.push({ text: place.name, kind: "current_plan_item", start, targetType: "plan_item" });
  }
  for (const shown of visible) {
    const name = typeof shown === "string" ? shown : shown.name;
    if (name.length < 2) continue;
    const start = message.indexOf(name);
    if (start >= 0) sources.push({ text: name, kind: "current_place", start, targetType: "place" });
  }
  sources.sort((a, b) => a.start - b.start || b.text.length - a.text.length);
  const selected = sources.filter((source, index) => !sources.slice(0, index).some(previous =>
    previous.start <= source.start && previous.start + previous.text.length > source.start));
  return selected.map(source => {
    if (source.ordinal) {
      if (source.targetType === "plan" || (plan?.recommendations.length && visible.length))
        return referenceToPlace(source.text, source.kind, undefined, source.targetType);
      const place = plan?.recommendations[source.ordinal - 1];
      if (place) return referenceToPlace(source.text, source.kind, place, "plan_item");
      const shown = visible[source.ordinal - 1];
      return referenceToPlace(source.text, source.kind, shown
        ? { name: typeof shown === "string" ? shown : shown.name } : undefined, "place");
    }
    if (source.slot) {
      const matches = (plan?.recommendations ?? []).filter(place => place.activitySlot === source.slot
        || (!place.activitySlot && (source.slot === "cafe" ? /카페/ : /식당|음식|맛집/).test(place.category)));
      return referenceToPlace(source.text, source.kind, matches.length === 1 ? matches[0] : undefined, "plan_item");
    }
    if (source.kind === "current_plan_item") {
      const matches = (plan?.recommendations ?? []).filter(place => place.name === source.text);
      return referenceToPlace(source.text, source.kind, matches.length === 1 ? matches[0] : undefined, "plan_item");
    }
    if (source.kind === "current_place") {
      const matches = visible.filter(place => (typeof place === "string" ? place : place.name) === source.text);
      return referenceToPlace(source.text, source.kind, matches.length === 1 ? { name: source.text } : undefined, "place");
    }
    return referenceToPlace(source.text, source.kind, undefined, source.targetType);
  });
}

function preferenceDimension(value: string) {
  if (/붐비|혼잡|조용|대화/.test(value)) return "crowd";
  if (/새로운|색다른|익숙|뻔한/.test(value)) return "novelty";
  if (/걷|도보/.test(value)) return "walking";
  if (/사진/.test(value)) return "photo";
  if (/식사|음식/.test(value)) return "food";
  return "experience";
}

function feedbackFrom(message: string, references: DateReference[]): DateFeedback[] {
  const target = references.find(reference => /카페|식당|장소|아까|전에/.test(reference.text));
  const feedback: DateFeedback[] = [];
  const cues: Array<[RegExp, string, DateFeedback["sentiment"]]> = [
    [/예쁜|예쁘|이쁜|이쁘|아름답|분위기\s*좋/, "space", "positive"],
    [/사람이\s*(?:너무\s*)?많|붐비|시끄러|시끄럽|웨이팅/, "crowd", "negative"],
    [/뻔해|뻔한|비슷한\s*건\s*싫/, "novelty", "negative"],
    [/좋았|마음에\s*들|나았/, "overall", "positive"],
    [/별로|싫었|마음에\s*안\s*들/, "overall", "negative"],
  ];
  for (const [pattern, attribute, sentiment] of cues) {
    const match = message.match(pattern);
    if (match) feedback.push({ target, attribute, sentiment, strength: /너무/.test(message) ? 0.9 : 0.7,
      confidence: 0.9, evidenceText: match[0], explicit: true });
  }
  return feedback;
}

function goalForClause(clause: string, route: ChatRoute | null | undefined, hasPlan: boolean,
  references: DateReference[], feedback: DateFeedback[]): DateGoal[] {
  const target = references.find(reference => clause.includes(reference.text));
  const goal = (type: DateGoalType, attribute?: string, confidence = 0.9): DateGoal =>
    ({ type, target, attribute, confidence });
  const goals: DateGoal[] = [];
  const change = isSwapRequest(clause) || /빼\s*줘|제외해|삭제해|추가해|넣어\s*줘|순서\s*바꿔|시간\s*(?:고쳐|바꿔|늦춰|앞당)/.test(clause);
  if (change) goals.push(goal("modify_itinerary"));
  if (/비교|차이|둘\s*중|어느\s*(?:게|쪽)/.test(clause) && /\?|어때|좋|나아|알려/.test(clause))
    goals.push(goal("compare_places"));
  else if (/왜\s*(?:골랐|추천)|추천\s*이유|왜.{0,40}(?:안\s*넣|제외|빠졌)/.test(clause))
    goals.push(goal("explain_recommendation"));
  else if (isQuestion(clause, hasPlan) && !/코스\s*짜|일정\s*짜/.test(clause)) {
    const attribute = /주차/.test(clause) ? "parking" : /영업|몇\s*시|휴무/.test(clause) ? "hours"
      : /예약/.test(clause) ? "reservation" : undefined;
    goals.push(goal("ask_venue", attribute));
  }
  if (isPlaceRequest(clause)) goals.push(goal("recommend_places"));
  if (!change && /코스|일정\s*짜|여행\s*계획|데이트\s*(?:코스|짜)/.test(clause)
    && /짜|만들|추천|계획/.test(clause)) goals.push(goal("create_itinerary"));
  if (/저장해|담아\s*줘|확정해/.test(clause)) goals.push(goal("save_itinerary"));
  if (feedback.some(item => clause.includes(item.evidenceText))) goals.push(goal("provide_feedback"));
  if (!goals.length && route) {
    const fallback: Record<ChatRoute["mode"], DateGoalType> = {
      course: hasPlan ? "modify_itinerary" : "create_itinerary", places: "recommend_places",
      question: "ask_venue", chat: "general_chat",
    };
    goals.push(goal(fallback[route.mode], undefined, route.confident ? 0.7 : 0.5));
  }
  return goals.length ? goals : [goal("general_chat", undefined, 0.4)];
}

/** Normalize one turn for observation only; execution still follows the legacy route and state. */
export function buildDateTurnUnderstanding(input: Input): DateTurnUnderstanding {
  const message = input.message.trim();
  const plan = input.currentPlan ?? input.context?.currentPlan ?? null;
  const visible = input.visiblePlaces ?? input.state.shownPlaces ?? [];
  let references = resolveReferences(message, plan, visible);
  const session = input.sessionCandidates ?? input.context?.sessionCandidates;
  if (session) {
    const named = session.records.filter(row => row.name.length >= 2
      && message.includes(row.name)
      && (row.shownCount > 0 || row.currentState === "selected" || row.rejectedReasons.length > 0)
      && session.records.filter(other => other.name === row.name).length === 1)
      .map(row => ({ text: row.name, kind: "previous_place" as const,
        targetType: "place" as const, resolvedId: row.candidateId,
        resolvedName: row.name, confidence: 0.9 }));
    references = [...references.filter(reference => !named.some(item => item.text === reference.text)), ...named];
  }
  const historicalClause = message.match(/(?:아까|이전에|전에|보여준)[^.!?]*/)?.[0]?.trim();
  if (session && historicalClause && references.filter(reference => reference.kind === "previous_place"
    && reference.resolvedId && historicalClause.includes(reference.text)).length < 2) {
    const hasOrdinal = /(?:(?:[1-9]\d*)|첫|두|세)\s*번째/.test(historicalClause);
    const resolved = resolveSessionShownReference(session, historicalClause)
      ?? (hasOrdinal ? null : resolveSessionRejectedReference(session, historicalClause));
    const historical: DateReference = resolved
      ? { text: historicalClause, kind: "previous_place", targetType: "place",
        resolvedId: resolved.candidateId, resolvedName: resolved.name, confidence: 0.9 }
      : { text: historicalClause, kind: "unresolved", targetType: "place", confidence: 0.2 };
    references = [historical, ...references.filter(reference => !historicalClause.includes(reference.text))];
  }
  const feedback = feedbackFrom(message, references);
  const provenance: DateUnderstandingProvenance[] = [];
  const explicitConstraints: DateTurnUnderstanding["explicitConstraints"] = {};
  const addConstraint = <K extends keyof DateIntent["hardConstraints"]>(key: K, value: DateIntent["hardConstraints"][K]) => {
    explicitConstraints[key] = value;
    provenance.push({ field: "explicitConstraints", key, source: "deterministic" });
  };
  const areas = extractAreasFromText(message);
  if (areas.length) addConstraint("areas", areas);
  const parsed = explicitDateConstraints(message, input.state, input.today);
  if (parsed.dateLabel) addConstraint("date", parsed.dateLabel);
  if (parsed.startTime) addConstraint("startTime", parsed.startTime);
  if (parsed.endTime) addConstraint("endTime", parsed.endTime);
  if (parsed.budgetWon !== undefined) addConstraint("budgetWon", parsed.budgetWon);
  const foods = explicitFoodExclusions(message);
  if (/회\s*(?:는|를)?\s*(?:싫|안\s*먹|못\s*먹|제외|빼)/.test(message)) foods.push("회");
  if (foods.length) addConstraint("excludedFoods", [...new Set(foods)]);

  const parts = clauseParts(message);
  const goals = parts.flatMap(part => goalForClause(part, input.legacyRoute, Boolean(plan?.items.length), references, feedback));
  const uniqueGoals = goals.filter((goal, index) => goals.findIndex(other => other.type === goal.type
    && other.target?.text === goal.target?.text && other.attribute === goal.attribute) === index);
  for (const goal of uniqueGoals) provenance.push({ field: "goals", key: goal.type,
    source: input.legacyRoute && goal.confidence <= 0.7 ? "legacy_route" : "deterministic" });
  for (const reference of references) provenance.push({ field: "references", key: reference.kind,
    source: reference.resolvedName ? "existing_state" : "deterministic" });

  const requestedChanges: DateRequestedChange[] = [];
  for (const part of parts) {
    if (!uniqueGoals.some(goal => goal.type === "modify_itinerary" && (!goal.target || part.includes(goal.target.text)))) continue;
    const target = references.find(reference => part.includes(reference.text));
    const operation: DateRequestedChange["operation"] | null = isSwapRequest(part) ? "replace"
      : /빼\s*줘|제외해|삭제해/.test(part) ? "remove"
        : /추가해|넣어\s*줘/.test(part) ? "add"
          : /순서\s*바꿔/.test(part) ? "reorder"
            : /시간\s*(?:고쳐|바꿔|늦춰|앞당)|여유롭게|빡빡하지/.test(part) ? "retime"
              : null;
    const routed = input.legacyRoute?.edit?.kind;
    const resolvedOperation = operation ?? (routed === "remove" || routed === "reorder" || routed === "retime" ? routed : null);
    if (resolvedOperation) requestedChanges.push({ operation: resolvedOperation, target, confidence: operation ? 0.9 : 0.7 });
  }
  for (const change of requestedChanges) provenance.push({ field: "requestedChanges", key: change.operation,
    source: input.legacyRoute?.edit && change.confidence < 0.9 ? "legacy_route" : "deterministic" });

  const modifying = uniqueGoals.some(goal => goal.type === "create_itinerary" || goal.type === "modify_itinerary");
  if (modifying) {
    const activities = extractActivitiesFromText(message);
    if (activities.length && !/\?|어때|좋을까/.test(message)) addConstraint("requiredActivities", activities);
    const names = extractPlacesFromText(message);
    if (names.length && !requestedChanges.some(change => change.operation === "remove" || change.operation === "replace"))
      addConstraint("requiredPlaces", names);
  }

  const semanticPreferences: SemanticPreference[] = deriveDateUnderstanding(message).inferredPreferences
    .map(item => ({ dimension: preferenceDimension(item.value), value: item.value,
      sentiment: "positive", strength: item.confidence, confidence: item.confidence,
      evidenceText: item.evidence, source: "legacy_heuristic" }));
  const softCues: Array<[RegExp, string, string, SemanticPreference["sentiment"]]> = [
    [/여유롭게|빡빡하지\s*않게|천천히/, "pace", "relaxed", "positive"],
    [/분위기\s*있게/, "vibe", "atmospheric", "positive"],
    [/기억에\s*남게/, "experience", "memorable", "positive"],
    [/좀\s*더\s*재밌게/, "activity", "more_fun", "positive"],
    [/지난번이랑\s*비슷한\s*건\s*싫어/, "novelty", "avoid_repeat", "negative"],
  ];
  for (const [pattern, dimension, value, sentiment] of softCues) {
    const match = message.match(pattern);
    if (match) semanticPreferences.push({ dimension, value, sentiment: sentiment ?? "neutral", strength: 0.9,
      confidence: 0.9, evidenceText: match[0], source: "legacy_heuristic" });
  }
  const grounded = compact(message);
  for (const item of input.interpretedIntent?.inferredPreferences ?? []) {
    if (!item.evidence || !grounded.includes(compact(item.evidence))) continue;
    if (semanticPreferences.some(existing => existing.value === item.value && existing.evidenceText === item.evidence)) continue;
    semanticPreferences.push({ dimension: preferenceDimension(item.value), value: item.value,
      sentiment: "positive", strength: item.confidence, confidence: item.confidence,
      evidenceText: item.evidence, source: input.interpretedSource ?? "unknown" });
    provenance.push({ field: "semanticPreferences", key: item.value,
      source: input.interpretedSource ?? "unknown" });
  }
  for (const preference of semanticPreferences) if (!provenance.some(item => item.field === "semanticPreferences" && item.key === preference.value))
    provenance.push({ field: "semanticPreferences", key: preference.value, source: "deterministic" });
  for (const item of feedback) provenance.push({ field: "feedback", key: item.attribute, source: "deterministic" });
  const ambiguities = references.filter(reference => reference.kind === "unresolved").map(reference => reference.text);
  return { rawMessage: message, goals: uniqueGoals, references, explicitConstraints,
    semanticPreferences, requestedChanges, feedback, ambiguities,
    confidence: ambiguities.length ? 0.5 : input.legacyRoute?.confident ? 0.9 : uniqueGoals.length ? 0.75 : 0.4,
    provenance };
}
