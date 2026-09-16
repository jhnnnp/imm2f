"use server";

import { getAppSession } from "@/features/auth/session";
import { listPlaces } from "@/features/places/actions";
import { analyzePreferencesWithOpenAi, type PreferenceInsight } from "@/lib/openai/analyzePreferences";
import { proposePlanEditsWithOpenAi } from "@/lib/openai/editPlan";
import { generatePlanOptionsWithOpenAi } from "@/lib/openai/generatePlan";
import type { PlanChange, PlanItem, PlanKind, PlanOption } from "@/features/planning/types/plan";
import type { Place } from "@/features/places/types/place";

export async function proposePlanEdits(input: {
  kind: PlanKind;
  prompt: string;
  items: PlanItem[];
}): Promise<{ changes: PlanChange[]; summary: string } | { error: string }> {
  return proposePlanEditsWithOpenAi({
    kind: input.kind,
    prompt: input.prompt,
    items: input.items.map(item => ({
      id: item.id,
      placeName: item.placeName,
      category: item.category,
      startTime: item.startTime,
      durationMinutes: item.durationMinutes,
      expectedCost: item.expectedCost,
    })),
  });
}

export async function generatePlanOptions(input: {
  kind: PlanKind;
  prompt: string;
  places?: Place[];
}): Promise<{ options: PlanOption[]; note: string } | { error: string }> {
  const places = input.places ?? (await listPlaces()).places;
  const usable = places.filter(place => !["dislike", "not_interested"].includes(place.userStatus));
  return generatePlanOptionsWithOpenAi({
    kind: input.kind,
    prompt: input.prompt,
    places: usable.map(place => ({
      id: place.id,
      name: place.name,
      categoryLabel: place.categoryLabel,
      district: place.district,
      durationMinutes: place.durationMinutes,
      expectedCostTwo: place.expectedCostTwo,
      userStatus: place.userStatus,
      partnerStatus: place.partnerStatus,
    })),
  });
}

export async function analyzeCouplePreferences(): Promise<PreferenceInsight | { error: string }> {
  const session = await getAppSession();
  const { places } = await listPlaces();
  const youName = session.mode === "authenticated" ? session.displayName : "나";
  const partnerName = session.mode === "authenticated"
    ? session.partner?.displayName ?? "파트너"
    : "파트너";

  return analyzePreferencesWithOpenAi({
    youName,
    partnerName,
    places: places.map(place => ({
      name: place.name,
      categoryLabel: place.categoryLabel,
      district: place.district,
      durationMinutes: place.durationMinutes,
      userStatus: place.userStatus,
      partnerStatus: place.partnerStatus,
    })),
  });
}
