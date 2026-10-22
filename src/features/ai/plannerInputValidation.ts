import type { AIPlannerState, PlanItem } from "@/features/planning/types/plan";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === "string" && value.length <= max;
const number = (value: unknown, max = 1_000_000_000): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const strings = (value: unknown, max = 500): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => text(item));
const rows = (value: unknown, valid: (item: unknown) => boolean, max = 500) => Array.isArray(value) && value.length <= max && value.every(valid);
const choice = (value: unknown, values: readonly string[]) => typeof value === "string" && values.includes(value);
const optional = (value: unknown, valid: (item: unknown) => boolean) => value === undefined || valid(value);
const nullable = (value: unknown, valid: (item: unknown) => boolean) => value === null || valid(value);
const activities = ["cafe", "meal", "walk", "exhibit", "movie", "performance", "indoor", "nightview"];
const cuisine = ["한식", "일식", "중식", "양식", "any"];
const activityList = (value: unknown) => rows(value, item => choice(item, activities), 8);
const clock = (value: unknown) => text(value, 5) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const coordinates = (value: unknown) => value === null || Array.isArray(value) && value.length === 2
  && typeof value[0] === "number" && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
  && typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;

/** Bound the complete request, including supplementary session data, before expensive work. */
export function boundedPlannerData(value: unknown) {
  let remaining = 300_000;
  function visit(item: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 14) return false;
    if (item === undefined || item === null || typeof item === "boolean") return true;
    if (typeof item === "string") { remaining -= item.length; return item.length <= 12_000 && remaining >= 0; }
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.length <= 500 && item.every(child => visit(child, depth + 1));
    return object(item) && Object.keys(item).length <= 100 && Object.entries(item).every(([key, child]) => {
      remaining -= key.length;
      return visit(child, depth + 1);
    });
  }
  return visit(value, 0);
}

export function validPlannerState(value: unknown): value is AIPlannerState {
  if (!object(value)) return false;
  if (!activityList(value.activities) || !text(value.region)
    || !["areas", "regions", "requiredPlaces", "excludedPlaces", "pinOrder", "conversationNotes"].every(key => strings(value[key]))
    || !["preserveExistingPlaces", "addStop"].every(key => typeof value[key] === "boolean")
    || !choice(value.pace, ["relaxed", "balanced", "active"])
    || !choice(value.intent, ["create", "modify", "remove", "reset", "clarify"])
    || !nullable(value.areaScope, item => choice(item, ["core", "walkable", "nearby"]))
    || !nullable(value.cuisine, item => choice(item, cuisine))
    || !nullable(value.stayKind, item => choice(item, ["date", "daytrip", "overnight"]))
    || !nullable(value.timeWindow, item => choice(item, ["afternoon", "evening", "night", "any"]))
    || !nullable(value.pendingSlot, item => choice(item, ["activity", "area", "scope", "span", "time", "cuisine", "indoor"]))
    || !number(value.nights, 14) || !Number.isInteger(value.nights)
    || !nullable(value.startTime, clock) || !nullable(value.endTime, clock)
    || !nullable(value.dateLabel, text) || !nullable(value.indoorPlay, text)) return false;
  if (!["objective"].every(key => optional(value[key], text))
    || !["excludedFoods", "userRequests", "shownPlaces", "seenPlaces"].every(key => optional(value[key], strings))
    || !["foodAllergy", "intakeFocusDone", "routeOnly"].every(key => optional(value[key], item => typeof item === "boolean"))
    || !optional(value.budgetWon, item => nullable(item, number))
    || !optional(value.walkingPreference, item => nullable(item, entry => entry === "short"))) return false;
  if (!optional(value.placeAsk, item => nullable(item, ask => object(ask) && choice(ask.kind,
    ["restaurant", "cafe", "bar", "dessert", "exhibit", "activity", "shopping", "festival", "spot"]) && text(ask.query) && text(ask.area)))) return false;
  if (!optional(value.preferences, item => object(item) && strings(item.vibe)
    && ["novelty", "intimacy", "activityLevel", "crowdTolerance", "scenicPreference", "foodImportance", "walkingTolerance"]
      .every(key => optional(item[key], entry => number(entry, 1))))) return false;
  if (!optional(value.inferredPreferences, item => rows(item, entry => object(entry) && text(entry.value) && text(entry.evidence) && number(entry.confidence, 1)))
    || !optional(value.memorySignals, item => rows(item, entry => object(entry) && text(entry.placeName) && choice(entry.reaction, ["crowded", "liked", "disliked"]) && number(entry.confidence, 1)))
    || !optional(value.memorySuggestions, item => object(item) && activityList(item.activities) && nullable(item.cuisine, entry => choice(entry, cuisine)))
    || !optional(value.explicitPlanningSelections, item => object(item) && optional(item.activities, activityList) && optional(item.cuisine, entry => choice(entry, cuisine)))) return false;
  return optional(value.discovery, item => object(item) && strings(item.themes) && strings(item.priorities)
    && rows(item.queries, entry => object(entry) && text(entry.region) && text(entry.query))
    && choice(item.transport, ["walk", "drive", "transit"]) && activityList(item.requiredActivities)
    && rows(item.activityOrder, entry => choice(entry, activities), 24)
    && number(item.minStops, 100) && number(item.maxStops, 100));
}

export function validPlanItems(value: unknown): value is PlanItem[] {
  return rows(value, item => object(item) && ["id", "placeId", "placeName", "category", "memo"].every(key => text(item[key]))
    && clock(item.startTime) && number(item.durationMinutes, 1440) && number(item.expectedCost)
    && number(item.order, 500) && Number.isInteger(item.order) && number(item.dayIndex, 6) && Number.isInteger(item.dayIndex)
    && optional(item.coordinates, coordinates));
}

function validStop(value: unknown) {
  return object(value) && text(value.name) && text(value.meta)
    && ["reason", "address", "phone", "mapUrl", "startTime", "image", "openingHours", "dishes", "factSourceUrl"].every(key => optional(value[key], text))
    && ["durationMinutes", "dayIndex", "rating", "ratingCount"].every(key => optional(value[key], number))
    && optional(value.distanceFromPreviousMeters, item => nullable(item, number))
    && optional(value.coordinates, coordinates);
}

function validCard(value: unknown) {
  return object(value) && text(value.headline) && strings(value.lines)
    && optional(value.stops, item => rows(item, validStop)) && optional(value.suggestions, strings)
    && optional(value.followUp, text)
    && optional(value.sources, item => rows(item, source => object(source) && text(source.label) && text(source.url)));
}

export function validateDatePlannerInput(value: unknown): string | null {
  if (!object(value) || !boundedPlannerData(value)) return "대화 정보를 확인하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  if (!["message", "prompt"].every(key => optional(value[key], item => text(item, 800)))) return "요청은 800자 이내의 글로 입력해 주세요. 긴 요청은 나눠서 보내 주세요.";
  const valid = optional(value.dateLabel, text) && optional(value.planningSessionId, text)
    && optional(value.planKind, item => choice(item, ["date", "trip"]))
    && ["previousPlaceNames", "selectedCandidateIds", "rejectedCandidateIds"].every(key => optional(value[key], strings))
    && optional(value.previousState, validPlannerState)
    && optional(value.previousStops, item => rows(item, stop => object(stop) && text(stop.name) && text(stop.category)
      && optional(stop.activitySlot, slot => choice(slot, [...activities, "other"]))))
    && ["courseStops", "shownStops"].every(key => optional(value[key], item => rows(item, validStop)))
    && optional(value.conversation, item => rows(item, turn => object(turn) && choice(turn.role, ["user", "assistant"]) && text(turn.text, 8000), 32));
  if (!valid) return "이전 대화나 일정 정보가 올바르지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  if (value.currentPlan !== undefined && value.currentPlan !== null) {
    const plan = value.currentPlan;
    const condition = object(plan) && object(plan.condition) ? plan.condition : null;
    if (!object(plan) || plan.status !== "plan" || !validPlannerState(plan.state) || !validPlanItems(plan.items)
      || !Array.isArray(plan.recommendations) || !rows(plan.recommendations, row => object(row) && ["id", "placeId", "name", "category", "district", "address", "phone", "mapUrl"].every(key => text(row[key]))
        && strings(row.reasons) && coordinates(row.coordinates) && number(row.durationMinutes, 1440) && number(row.expectedCost)
        && ["dishes", "factSourceUrl"].every(key => optional(row[key], text))
        && ["rating", "ratingCount"].every(key => optional(row[key], number)))
      || plan.recommendations.length !== plan.items.length || !validCard(plan.card) || !condition
      || !["dateLabel", "startTime", "endTime", "region"].every(key => text(condition[key]))
      || !nullable(condition.budget, number) || typeof condition.timeSpecified !== "boolean")
      return "기존 코스 정보를 확인하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
  }
  return null;
}

export function validateBasicPlannerInput(value: unknown, kind: "edit" | "options"): string | null {
  if (!object(value) || !boundedPlannerData(value) || !choice(value.kind, ["date", "trip"])) return "일정 정보를 확인하지 못했어요. 다시 시도해 주세요.";
  if (!text(value.prompt, 800) || !value.prompt.trim()) return "변경하거나 추천받을 내용을 800자 이내로 입력해 주세요.";
  if (kind === "edit" && !validPlanItems(value.items)) return "수정할 일정 정보를 확인하지 못했어요. 새로고침 후 다시 시도해 주세요.";
  if (kind === "options" && !optional(value.places, item => rows(item, place => object(place)
    && ["id", "name", "categoryLabel", "district", "userStatus", "partnerStatus"].every(key => text(place[key]))
    && number(place.durationMinutes, 1440) && nullable(place.expectedCostTwo, number), 500))) return "장소 목록을 확인하지 못했어요. 새로고침 후 다시 시도해 주세요.";
  return null;
}
