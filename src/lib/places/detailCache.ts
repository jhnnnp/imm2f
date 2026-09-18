import { createClient } from "@/lib/supabase/server";
import { dateCategoryLabel } from "@/features/ai/dateCourse";
import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import { loadTourPlaceDetail } from "@/lib/tourapi/client";

export type PlaceDetailCacheRow = {
  external_source: "kakao" | "tourapi";
  external_place_id: string;
  name: string;
  leaf: string;
  phone: string | null;
  map_url: string | null;
  image: string | null;
  hours: string | null;
  rating: number | null;
  rating_count: number | null;
  food: string | null;
  source_url: string | null;
  blurb: string | null;
};

function cacheKey(candidate: Pick<DiscoverCandidate, "externalSource" | "externalPlaceId">) {
  return `${candidate.externalSource}:${candidate.externalPlaceId}`;
}

export function mergePlaceFacts(
  candidate: DiscoverCandidate,
  cache: Map<string, PlaceDetailCacheRow>,
  saved: Place[],
): DiscoverCandidate {
  const cached = cache.get(cacheKey(candidate));
  const match = saved.find(place => (
    (place.externalSource === candidate.externalSource && place.externalPlaceId === candidate.externalPlaceId)
    || place.name === candidate.name
  ));
  return {
    ...candidate,
    phone: candidate.phone || cached?.phone || match?.phone || "",
    mapUrl: candidate.mapUrl || cached?.map_url || match?.mapUrl || "",
    image: candidate.image || cached?.image || match?.image,
    openingHours: candidate.openingHours || cached?.hours || match?.openingHours || undefined,
    rating: candidate.rating ?? (cached?.rating == null ? undefined : Number(cached.rating)),
    ratingCount: candidate.ratingCount ?? cached?.rating_count ?? undefined,
    dishes: candidate.dishes || cached?.food || undefined,
    factSourceUrl: candidate.factSourceUrl || cached?.source_url || undefined,
    factNote: candidate.factNote || cached?.blurb || undefined,
  };
}

export async function readPlaceDetailCache(
  candidates: Array<Pick<DiscoverCandidate, "externalSource" | "externalPlaceId">>,
) {
  const cache = new Map<string, PlaceDetailCacheRow>();
  if (!candidates.length) return cache;
  try {
    const supabase = await createClient();
    if (!supabase) return cache;
    const { data, error } = await supabase
      .from("place_details_cache")
      .select("external_source, external_place_id, name, leaf, phone, map_url, image, hours, rating, rating_count, food, source_url, blurb")
      .in("external_place_id", [...new Set(candidates.map(item => item.externalPlaceId))]);
    if (error || !data) return cache;
    for (const row of data) {
      const source = row.external_source === "tourapi" ? "tourapi" : "kakao";
      cache.set(`${source}:${row.external_place_id}`, {
        external_source: source,
        external_place_id: row.external_place_id,
        name: row.name,
        leaf: row.leaf,
        phone: row.phone,
        map_url: row.map_url,
        image: row.image,
        hours: row.hours,
        rating: row.rating,
        rating_count: row.rating_count,
        food: row.food,
        source_url: row.source_url,
        blurb: row.blurb,
      });
    }
  } catch {
    return cache;
  }
  return cache;
}

export async function writePlaceDetailCache(candidates: DiscoverCandidate[]) {
  if (!candidates.length) return;
  try {
    const supabase = await createClient();
    if (!supabase) return;
    const rows = candidates.map(candidate => ({
      external_source: candidate.externalSource,
      external_place_id: candidate.externalPlaceId,
      name: candidate.name,
      leaf: dateCategoryLabel(candidate),
      phone: candidate.phone || null,
      map_url: candidate.mapUrl || null,
      image: candidate.image || null,
      hours: candidate.openingHours || null,
      rating: candidate.rating ?? null,
      rating_count: candidate.ratingCount ?? null,
      food: candidate.dishes || null,
      source_url: candidate.factSourceUrl || null,
      blurb: candidate.factNote || null,
      fetched_at: new Date().toISOString(),
    }));
    await supabase.from("place_details_cache").upsert(rows, { onConflict: "external_source,external_place_id" });
  } catch {
    return;
  }
}

export async function hydrateDateCandidates(candidates: DiscoverCandidate[], saved: Place[]) {
  const cache = await readPlaceDetailCache(candidates);
  const merged = candidates.map(candidate => mergePlaceFacts(candidate, cache, saved));
  const missingTour = merged
    .filter(candidate => candidate.externalSource === "tourapi" && (!candidate.image || !candidate.openingHours))
    .slice(0, 5);
  await Promise.all(missingTour.map(async candidate => {
    const detail = await loadTourPlaceDetail(candidate.externalPlaceId, candidate.category);
    if (!detail) return;
    candidate.image = candidate.image || detail.image;
    candidate.openingHours = candidate.openingHours || detail.openingHours || undefined;
  }));
  void writePlaceDetailCache(merged);
  return merged;
}
