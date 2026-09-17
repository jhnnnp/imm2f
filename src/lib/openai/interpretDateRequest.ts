import type { AIPlannerState, DateAreaScope, DateChatTurn, DateCuisineChoice, DateIntakeSlot, DateStayKind, DateTimeWindow } from "@/features/planning/types/plan";
import {
  asAreaScope,
  asCuisineChoice,
  asTimeWindow,
  canonicalizeArea,
  DATE_LANDMARKS,
  emptyDateBrief,
  extractActivitiesFromText,
  extractAreaScope,
  extractAreasFromText,
  extractCuisine,
  extractIndoorPlay,
  extractPlacesFromText,
  extractStay,
  extractTimeWindow,
  groundedAreas,
  isDateActivityId,
  missingSlot,
  uniqueActivities,
  uniqueStrings,
  withAreas,
  withTimeWindow,
} from "@/features/ai/dateBrief";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";
import { chatSituationFromMessage } from "./composeDateChat";

export type IntentPayload = {
  intent?: AIPlannerState["intent"];
  addActivities?: string[];
  removeActivities?: string[];
  addAreas?: string[];
  removeAreas?: string[];
  addPlaces?: string[];
  removePlaces?: string[];
  cuisine?: DateCuisineChoice | null;
  indoorPlay?: string | null;
  areaScope?: DateAreaScope | null;
  timeWindow?: DateTimeWindow | null;
  stayKind?: DateStayKind | null;
  nights?: number | null;
  pace?: AIPlannerState["pace"] | null;
  startTime?: string | null;
  endTime?: string | null;
  preserveExistingPlaces?: boolean;
  conversationNote?: string;
  askSlot?: DateIntakeSlot | null;
  reply?: string;
};

function asQuestionSlot(value: unknown): DateIntakeSlot | null {
  return value === "area" ? value : null;
}

function asTime(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return null;
  const [hour, minute] = raw.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function fallbackPatch(message: string): IntentPayload {
  const removing = /빼|제외|삭제|가지\s*마/.test(message);
  const activities = extractActivitiesFromText(message);
  const places = extractPlacesFromText(message);
  const adding = /들러|경유|가고\s*싶|포함|추가|넣어|갈\s*수|있나/.test(message);
  const stay = extractStay(message);
  return {
    intent: removing ? "remove" : /처음부터|새로|전부\s*바꿔|리셋/.test(message) ? "reset" : undefined,
    addActivities: removing ? [] : activities,
    removeActivities: removing ? activities : [],
    addAreas: extractAreasFromText(message),
    addPlaces: removing ? [] : places,
    removePlaces: removing ? places : [],
    cuisine: extractCuisine(message),
    indoorPlay: extractIndoorPlay(message),
    areaScope: extractAreaScope(message),
    timeWindow: extractTimeWindow(message),
    stayKind: stay?.stayKind ?? null,
    nights: stay?.nights ?? null,
    pace: /여유|천천히|오래/.test(message) ? "relaxed" : /많이|알차게|활동/.test(message) ? "active" : null,
    preserveExistingPlaces: !/처음부터|새로|전부\s*바꿔|리셋/.test(message),
    conversationNote: adding ? `기존 코스에 ${places.join(", ") || "장소"}를 더함` : message,
  };
}

export function mergeDateState(previous: AIPlannerState | undefined, patch: IntentPayload, dateLabel?: string): AIPlannerState {
  const base = previous ?? emptyDateBrief();
  const intent = ["create", "modify", "remove", "reset", "clarify"].includes(String(patch.intent))
    ? patch.intent as AIPlannerState["intent"]
    : previous ? "modify" : "create";
  const reset = intent === "reset" || patch.preserveExistingPlaces === false;
  const addActivities = uniqueActivities(patch.addActivities ?? []);
  const removeActivities = uniqueActivities(patch.removeActivities ?? []);
  const activities = uniqueActivities([...(reset ? [] : base.activities), ...addActivities].filter(id => !removeActivities.includes(id)));
  const addAreas = uniqueStrings((patch.addAreas ?? []).map(canonicalizeArea), 3);
  const removeAreas = uniqueStrings((patch.removeAreas ?? []).map(canonicalizeArea), 3);
  const areas = uniqueStrings([...(reset ? [] : base.areas), ...addAreas].filter(area => !removeAreas.includes(area)), 3);
  const addPlaces = uniqueStrings(patch.addPlaces ?? [], 6).filter(place => {
    if (isDateActivityId(place)) return false;
    if (DATE_LANDMARKS.some(landmark => landmark === place)) return true;
    return !areas.includes(place);
  });
  const removePlaces = uniqueStrings(patch.removePlaces ?? [], 4);
  const requiredPlaces = uniqueStrings([...(reset ? [] : base.requiredPlaces), ...addPlaces].filter(place => !removePlaces.includes(place)), 6);
  const indoorPlay = patch.indoorPlay?.trim() || (reset ? null : base.indoorPlay);
  const timeWindow = asTimeWindow(patch.timeWindow) ?? (reset ? null : base.timeWindow);
  const timed = timeWindow && timeWindow !== base.timeWindow ? withTimeWindow(base, timeWindow) : base;
  const stayKind = patch.stayKind === "date" || patch.stayKind === "daytrip" || patch.stayKind === "overnight"
    ? patch.stayKind
    : (reset ? null : base.stayKind);
  const nights = stayKind === "overnight"
    ? Math.max(1, Math.min(2, Number(patch.nights ?? (reset ? 1 : base.nights)) || 1))
    : 0;
  const areaScope = asAreaScope(patch.areaScope) ?? (reset ? null : base.areaScope);
  const located = withAreas({ ...base, areaScope }, areas);
  return {
    activities,
    areas: located.areas,
    region: located.region,
    regions: located.regions,
    areaScope: located.areaScope,
    requiredPlaces,
    excludedPlaces: uniqueStrings([...(reset ? [] : base.excludedPlaces), ...removePlaces].filter(place => !addPlaces.includes(place)), 8),
    cuisine: asCuisineChoice(patch.cuisine) ?? (reset ? null : base.cuisine),
    indoorPlay: indoorPlay || null,
    pace: patch.pace === "relaxed" || patch.pace === "active" || patch.pace === "balanced" ? patch.pace : base.pace,
    stayKind,
    nights,
    timeWindow: timeWindow ?? timed.timeWindow,
    startTime: patch.startTime === undefined ? timed.startTime : asTime(patch.startTime) ?? timed.startTime,
    endTime: patch.endTime === undefined ? timed.endTime : asTime(patch.endTime) ?? timed.endTime,
    dateLabel: dateLabel || base.dateLabel,
    pinOrder: reset ? [] : uniqueStrings(base.pinOrder, 8),
    preserveExistingPlaces: patch.preserveExistingPlaces !== false,
    intent,
    pendingSlot: missingSlot({
      ...base,
      activities,
      areas: located.areas,
      regions: located.regions,
      areaScope: located.areaScope,
      cuisine: asCuisineChoice(patch.cuisine) ?? (reset ? null : base.cuisine),
      indoorPlay: indoorPlay || null,
      stayKind,
      nights,
      timeWindow: timeWindow ?? timed.timeWindow,
      startTime: patch.startTime === undefined ? timed.startTime : asTime(patch.startTime) ?? timed.startTime,
    }),
    conversationNotes: [...(reset ? [] : base.conversationNotes), String(patch.conversationNote ?? "").trim()].filter(Boolean).slice(-12),
  };
}

function usableReply(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || /^false$/i.test(text) || text.length < 8) return "";
  return text.slice(0, 500);
}

export function applyInterpretPatch(input: {
  message: string;
  previousState?: AIPlannerState;
  dateLabel?: string;
  patch: IntentPayload;
}) {
  const merged = mergeDateState(input.previousState, input.patch, input.dateLabel);
  const areas = groundedAreas(input.message, input.previousState, merged.areas);
  const state = withAreas({ ...merged, pendingSlot: null }, areas);
  const next = { ...state, pendingSlot: missingSlot(state) };
  return { state: next, slot: missingSlot(next), reply: usableReply(input.patch.reply) };
}

export function shouldSkipDateNlu(message: string) {
  return Boolean(chatSituationFromMessage(message));
}

export async function interpretDateRequest(input: {
  message: string;
  previousState?: AIPlannerState;
  previousPlaceNames: string[];
  dateLabel?: string;
  conversation?: DateChatTurn[];
}) {
  const localPatch = fallbackPatch(input.message);
  const fallback = () => applyInterpretPatch({
    message: input.message,
    previousState: input.previousState,
    dateLabel: input.dateLabel,
    patch: localPatch,
  });
  if (!isOpenAiConfigured() || shouldSkipDateNlu(input.message)) return fallback();
  try {
    const patch = await completeJson<IntentPayload>({
      temperature: 0,
      maxTokens: 1200,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: [
            "Extract a structured date brief from Korean chat. Be a concise concierge, not a chatty companion.",
            "Return JSON only:",
            '{"intent":"create|modify|remove|reset|clarify","addActivities":["cafe"|"meal"|"walk"|"exhibit"|"indoor"|"nightview"],"removeActivities":[],"addAreas":[],"removeAreas":[],"addPlaces":[],"removePlaces":[],"cuisine":"한식"|"일식"|"중식"|"양식"|"any"|null,"indoorPlay":"방탈출"|"보드게임"|"볼링"|"오락실"|"만화카페"|"VR 체험"|"상관없음"|null,"areaScope":"core"|"walkable"|"nearby"|null,"timeWindow":"afternoon"|"evening"|"night"|"any"|null,"stayKind":"date"|"daytrip"|"overnight"|null,"nights":0|1|2|null,"pace":"relaxed"|"balanced"|"active"|null,"startTime":"HH:MM"|null,"endTime":"HH:MM"|null,"preserveExistingPlaces":true,"conversationNote":"short Korean restatement of the latest change only","askSlot":null,"reply":""}',
            "Never invent a city or neighborhood the user did not write. addAreas may only contain names that appear in latestMessage.",
            "From 여행가고싶어, 데이트하고싶어, 놀러가고싶어 with no place: addAreas:[], askSlot:\"area\", intent:\"clarify\", reply asking where to go. Do not copy example cities into addAreas.",
            "From 군산 여행 가려고 하는데 일정 짜줘: addAreas:[\"군산\"], stayKind null unless nights were said, reply empty. From 군산 1박2일: addAreas:[\"군산\"], stayKind:\"overnight\", nights:1.",
            "From 성수에서 데이트하고 싶어: addAreas:[\"성수\"], stayKind:\"date\", nights:0. Infer 2-3 activities from the vibe only if the user named them. Do not always choose cafe+meal+walk.",
            "stayKind: 데이트→date, 당일치기/하루만→daytrip, 1박2일/2박3일/여행+박→overnight. Bare 여행 with no nights leaves stayKind null so the app can ask.",
            "If the user names a destination, never askSlot area. Time only if they mentioned when, not because they said 저녁 먹고 싶어.",
            "askSlot may be area only when no city or neighborhood can be inferred. Never ask activity, cuisine, scope, or indoor.",
            "reply is empty whenever a course can be generated. When asking where to go, one polite 해요체 sentence. No emoji, no 반말, no vibe adjectives.",
            "If the user only greets, thanks you, or asks what you can do, intent:\"clarify\" and put the answer in reply. Do not set intent clarify when addAreas is non-empty.",
            "Activity map: 카페/커피/디저트→cafe; 식사/저녁/점심/밥/맛집/파스타/라멘→meal; 산책/공원/한강→walk; 전시/미술관/갤러리→exhibit; 방탈출/보드게임/볼링/오락실/실내 놀거리→indoor; 야경/전망대/루프탑→nightview.",
            "Cuisine: 파스타/피자/브런치/스테이크→양식; 라멘/스시/초밥/오마카세→일식; 국밥/고기/갈비→한식.",
            "If currentPlaces is non-empty and the user asks to add a stop (추가, 넣어, 갈 수 있나, 들러), set addPlaces to that landmark, keep addAreas empty, preserveExistingPlaces true, intent modify.",
            "If the user asks to swap one stop (카페 변경 해줘), keep preserveExistingPlaces true, put the current matching venue into removePlaces, intent modify.",
            "areaScope only if the user mentioned range. Time only if they mentioned when, not because they said 저녁 먹고 싶어. Cuisine only if they mentioned food type.",
            "Never return clarifyingQuestion. Never return the boolean or string false.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            currentBrief: input.previousState ?? emptyDateBrief(),
            currentPlaces: input.previousPlaceNames,
            recentTurns: (input.conversation ?? []).slice(-8),
            latestMessage: input.message,
          }),
        },
      ],
    });
    if (!patch) return fallback();
    return applyInterpretPatch({
      message: input.message,
      previousState: input.previousState,
      dateLabel: input.dateLabel,
      patch: { ...patch, askSlot: asQuestionSlot(patch.askSlot) },
    });
  } catch {
    return fallback();
  }
}
