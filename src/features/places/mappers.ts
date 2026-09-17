import type { Place, PlaceCategoryId, PlacePreferenceStatus } from "./types/place";
import { PLACE_CATEGORIES } from "./config/placeCategories";
import type { Database } from "@/lib/supabase/database.types";

type PlaceRow = Database["public"]["Tables"]["places"]["Row"] & {
  place_preferences?: Database["public"]["Tables"]["place_preferences"]["Row"][] | null;
};

const STATUSES: PlacePreferenceStatus[] = ["visited", "want", "must_visit", "revisit", "neutral", "dislike", "not_interested"];
const TONE_BY_CATEGORY: Record<PlaceCategoryId, Place["visualTone"]> = {
  cafe: "brown",
  restaurant: "brown",
  nature: "blue",
  photo: "brown",
  book: "green",
  tourist: "green",
  festival: "blue",
  stay: "brown",
};

export function visualToneForCategory(category: PlaceCategoryId): Place["visualTone"] {
  return TONE_BY_CATEGORY[category];
}

function asStatus(value: string | null | undefined): PlacePreferenceStatus {
  return value && STATUSES.includes(value as PlacePreferenceStatus) ? (value as PlacePreferenceStatus) : "neutral";
}

function asCategory(value: string): PlaceCategoryId {
  return PLACE_CATEGORIES.some(item => item.id === value) ? (value as PlaceCategoryId) : "cafe";
}

export function mapPlaceRow(row: PlaceRow, userId: string, partnerId: string | null): Place {
  const prefs = row.place_preferences ?? [];
  const userPref = prefs.find(item => item.user_id === userId);
  const partnerPref = partnerId ? prefs.find(item => item.user_id === partnerId) : undefined;
  const category = asCategory(row.category);
  return {
    id: row.id,
    name: row.name,
    category,
    categoryLabel: row.category_label || PLACE_CATEGORIES.find(item => item.id === category)?.label || category,
    district: row.district,
    address: row.address || undefined,
    roadAddress: row.road_address || undefined,
    mapUrl: row.map_url || undefined,
    phone: row.phone || undefined,
    openingHours: row.opening_hours,
    description: row.description,
    durationMinutes: row.duration_minutes,
    expectedCostTwo: row.expected_cost_two,
    coordinates: row.lng != null && row.lat != null ? [row.lng, row.lat] : null,
    image: row.image ?? undefined,
    visualTone: (["photo", "blue", "brown", "green"] as const).includes(row.visual_tone as Place["visualTone"])
      ? (row.visual_tone as Place["visualTone"])
      : visualToneForCategory(category),
    userStatus: asStatus(userPref?.status),
    partnerStatus: asStatus(partnerPref?.status),
    userRated: Boolean(userPref),
    partnerRated: Boolean(partnerPref),
    userFit: userPref?.fit ?? 0,
    partnerFit: partnerPref?.fit ?? 0,
    externalSource: row.external_source === "kakao" || row.external_source === "tourapi" ? row.external_source : "manual",
    externalPlaceId: row.external_place_id || undefined,
  };
}
