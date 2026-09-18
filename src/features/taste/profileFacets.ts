import {
  labelForActivity,
  labelForCrowd,
  labelForCuisine,
  labelForDateFlow,
  labelForDrink,
  labelForPace,
  labelForSetting,
  labelForTime,
} from "./options";
import type { TasteProfile } from "./types";

export type TasteFacet = {
  label: string;
  items: string[];
  kind?: "avoid";
};

function uniqueLabels(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

export function profileFacets(profile: TasteProfile): TasteFacet[] {
  const rhythm = uniqueLabels([
    labelForPace(profile.pace),
    labelForTime(profile.timeWindow),
    labelForDateFlow(profile.dateFlow),
    profile.indoorPlay && profile.indoorPlay !== "상관없음" ? profile.indoorPlay : "",
    labelForSetting(profile.setting),
    labelForCrowd(profile.crowd),
  ]);
  const table = uniqueLabels([
    ...profile.cuisines.map(labelForCuisine),
    profile.drink !== "any" ? labelForDrink(profile.drink) : "",
  ]);
  return [
    { label: "자주 가는 동네", items: profile.areas },
    { label: "하루", items: rhythm },
    { label: "하고 싶은 것", items: profile.activities.map(labelForActivity) },
    { label: "음식·술", items: table },
    { label: "코스에서 빼는 것", items: profile.avoidFoods, kind: "avoid" as const },
  ].filter(facet => facet.items.length);
}
