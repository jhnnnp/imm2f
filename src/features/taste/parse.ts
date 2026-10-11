import { DATE_ACTIVITY_OPTIONS } from "@/features/ai/dateBrief";
import type { DateActivityId, DateAreaScope, DateTimeWindow } from "@/features/planning/types/plan";
import { canonicalizeArea, TASTE_AVOID_OPTIONS } from "./options";
import type {
  TasteCrowd,
  TasteCuisine,
  TasteDateFlow,
  TasteDrink,
  TasteInput,
  TastePace,
  TasteProfile,
  TasteSetting,
} from "./types";

const PACE = new Set<TastePace>(["linger", "mixed", "walk"]);
const SETTING = new Set<TasteSetting>(["indoor", "outdoor", "mix"]);
const CROWD = new Set<TasteCrowd>(["quiet", "lively", "mix"]);
const TIME = new Set<DateTimeWindow>(["afternoon", "evening", "night", "any"]);
const SCOPE = new Set<DateAreaScope>(["core", "walkable", "nearby"]);
const DATE_FLOW = new Set<TasteDateFlow>(["meal_first", "cafe_first", "flex"]);
const DRINK = new Set<TasteDrink>(["none", "light", "any"]);
const CUISINE = new Set<TasteCuisine>(["한식", "일식", "중식", "양식", "any"]);
const ACTIVITY = new Set<DateActivityId>(DATE_ACTIVITY_OPTIONS.map(item => item.id));

function unique(values: string[], max: number) {
  const next: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || next.includes(trimmed)) continue;
    next.push(trimmed);
    if (next.length >= max) break;
  }
  return next;
}

function asList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function emptyTasteInput(): TasteInput {
  return {
    areas: [],
    pace: "",
    activities: [],
    cuisines: [],
    avoidFoods: [],
    setting: "",
    crowd: "",
    timeWindow: "",
    areaScope: "",
    dateFlow: "",
    drink: "any",
    indoorPlay: "",
    note: "",
  };
}

export function inputFromProfile(profile: TasteProfile): TasteInput {
  return {
    areas: profile.areas,
    pace: profile.pace,
    activities: profile.activities,
    cuisines: profile.cuisines,
    avoidFoods: profile.avoidFoods,
    setting: profile.setting,
    crowd: profile.crowd,
    timeWindow: profile.timeWindow,
    areaScope: profile.areaScope,
    dateFlow: profile.dateFlow,
    drink: profile.drink,
    indoorPlay: profile.indoorPlay,
    note: profile.note,
  };
}

export function parseTasteProfile(value: unknown): TasteProfile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const areas = unique(asList(row.areas).map(canonicalizeArea), 4);
  const pace = PACE.has(row.pace as TastePace) ? row.pace as TastePace : null;
  const activities = unique(asList(row.activities), 4).filter((item): item is DateActivityId => ACTIVITY.has(item as DateActivityId));
  const cuisines = unique(asList(row.cuisines), 4).filter((item): item is TasteCuisine => CUISINE.has(item as TasteCuisine));
  const avoidFoods = unique(asList(row.avoid_foods ?? row.avoidFoods).map(item => item.slice(0, 16)), 8);
  const setting = SETTING.has(row.setting as TasteSetting) ? row.setting as TasteSetting : null;
  const crowd = CROWD.has(row.crowd as TasteCrowd) ? row.crowd as TasteCrowd : null;
  const timeWindow = TIME.has(row.time_window as DateTimeWindow)
    ? row.time_window as DateTimeWindow
    : TIME.has(row.timeWindow as DateTimeWindow) ? row.timeWindow as DateTimeWindow : null;
  const areaScope = SCOPE.has(row.area_scope as DateAreaScope)
    ? row.area_scope as DateAreaScope
    : SCOPE.has(row.areaScope as DateAreaScope) ? row.areaScope as DateAreaScope : "walkable";
  const dateFlow = DATE_FLOW.has(row.date_flow as TasteDateFlow)
    ? row.date_flow as TasteDateFlow
    : DATE_FLOW.has(row.dateFlow as TasteDateFlow) ? row.dateFlow as TasteDateFlow : "flex";
  const drink = DRINK.has(row.drink as TasteDrink) ? row.drink as TasteDrink : "any";
  const indoorPlay = String(row.indoor_play ?? row.indoorPlay ?? "").trim().slice(0, 20);
  const note = String(row.note ?? "").trim().slice(0, 160);
  if (!areas.length || !pace || !activities.length || !cuisines.length || !setting || !crowd || !timeWindow) {
    return null;
  }
  return {
    areas,
    pace,
    activities,
    cuisines,
    avoidFoods,
    setting,
    crowd,
    timeWindow,
    areaScope,
    dateFlow,
    drink,
    indoorPlay: activities.includes("indoor") ? (indoorPlay || "상관없음") : "",
    note,
  };
}

export function parseTasteInput(value: unknown): TasteProfile | { error: string } {
  const invalid = { error: "취향 항목의 형식을 확인하고 다시 시도해 주세요." };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const row = value as Record<string, unknown>;
  for (const [key, count, length] of [["areas", 4, 80], ["activities", 4, 32], ["cuisines", 4, 16], ["avoidFoods", 8, 16]] as const) {
    const entries = row[key];
    if (!Array.isArray(entries) || entries.length > count || entries.some(item => typeof item !== "string" || item.length > length)) return invalid;
  }
  if (typeof row.note !== "string" || row.note.length > 160
    || typeof row.indoorPlay !== "string" || row.indoorPlay.length > 20
    || !PACE.has(row.pace as TastePace) || !SETTING.has(row.setting as TasteSetting)
    || !CROWD.has(row.crowd as TasteCrowd) || !TIME.has(row.timeWindow as DateTimeWindow)
    || (row.areaScope !== "" && !SCOPE.has(row.areaScope as DateAreaScope))
    || (row.drink !== "" && !DRINK.has(row.drink as TasteDrink))) return invalid;
  const input = value as TasteInput;
  if (input.activities.some(item => !ACTIVITY.has(item)) || input.cuisines.some(item => !CUISINE.has(item))
    || input.avoidFoods.some(item => item.trim() !== "" && !allowedAvoid(item))) return invalid;
  const areaScope = SCOPE.has(input.areaScope as DateAreaScope) ? input.areaScope : "walkable";
  const dateFlow = DATE_FLOW.has(input.dateFlow as TasteDateFlow) ? input.dateFlow : null;
  const drink = DRINK.has(input.drink as TasteDrink) ? input.drink : "any";
  const indoorPlay = input.activities.includes("indoor")
    ? String(input.indoorPlay || "상관없음").trim().slice(0, 20)
    : "";
  if (!dateFlow) {
    return { error: "코스 순서를 골라 주세요." };
  }
  return parseTasteProfile({
    areas: input.areas,
    pace: input.pace,
    activities: input.activities,
    cuisines: input.cuisines,
    avoid_foods: input.avoidFoods,
    setting: input.setting,
    crowd: input.crowd,
    time_window: input.timeWindow,
    area_scope: areaScope,
    date_flow: dateFlow,
    drink,
    indoor_play: indoorPlay,
    note: input.note,
  }) ?? { error: "아직 비어 있는 항목이 있어요. 가고 싶은 동네와 하루의 속도, 하고 싶은 것, 식사 취향을 확인해 주세요." };
}

export function allowedAvoid(value: string) {
  const trimmed = value.trim().slice(0, 16);
  if (!trimmed) return "";
  if ((TASTE_AVOID_OPTIONS as readonly string[]).includes(trimmed)) return trimmed;
  if (!/^[가-힣A-Za-z0-9 ]{2,16}$/.test(trimmed)) return "";
  return trimmed;
}
