import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { dateCategoryLabel } from "@/features/ai/dateCourse";
import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import { loadTourPlaceDetail } from "@/lib/tourapi/client";
import { distanceMeters } from "@/features/places/geo";

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
  fetched_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function fresh(row: PlaceDetailCacheRow | undefined, ttlMs: number) {
  if (!row) return false;
  const age = Date.now() - Date.parse(row.fetched_at);
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

function cacheKey(candidate: Pick<DiscoverCandidate, "externalSource" | "externalPlaceId">) {
  return `${candidate.externalSource}:${candidate.externalPlaceId}`;
}

function sameSavedVenue(place: Place, candidate: DiscoverCandidate) {
  if (place.externalSource === candidate.externalSource && place.externalPlaceId === candidate.externalPlaceId) return true;
  if (place.name !== candidate.name) return false;
  const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
  const savedAddress = place.roadAddress || place.address;
  if (savedAddress && [candidate.roadAddress, candidate.address].some(address => address && compact(address) === compact(savedAddress))) return true;
  return Boolean(place.coordinates && distanceMeters(place.coordinates, candidate.coordinates) < 60);
}

export function mergePlaceFacts(
  candidate: DiscoverCandidate,
  cache: Map<string, PlaceDetailCacheRow>,
  saved: Place[],
): DiscoverCandidate {
  const row = cache.get(cacheKey(candidate));
  const cached = row?.name.trim() === candidate.name.trim() ? row : undefined;
  const stable = fresh(cached, 30 * DAY_MS) ? cached : undefined;
  const currentHours = fresh(cached, DAY_MS) ? cached : undefined;
  const currentFacts = fresh(cached, 7 * DAY_MS) ? cached : undefined;
  const match = saved.find(place => sameSavedVenue(place, candidate));
  return {
    ...candidate,
    phone: candidate.phone || stable?.phone || match?.phone || "",
    mapUrl: candidate.mapUrl || stable?.map_url || match?.mapUrl || "",
    image: candidate.image || stable?.image || match?.image,
    openingHours: candidate.openingHours || currentHours?.hours || undefined,
    rating: candidate.rating ?? (currentFacts?.rating == null ? undefined : Number(currentFacts.rating)),
    ratingCount: candidate.ratingCount ?? currentFacts?.rating_count ?? undefined,
    dishes: candidate.dishes || currentFacts?.food || undefined,
    factSourceUrl: candidate.factSourceUrl || currentFacts?.source_url || undefined,
    factNote: candidate.factNote || currentFacts?.blurb || undefined,
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
      .select("external_source, external_place_id, name, leaf, phone, map_url, image, hours, rating, rating_count, food, source_url, blurb, fetched_at")
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
        fetched_at: row.fetched_at,
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
    const supabase = createServiceClient();
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
  const targets = officialTourEvidenceTargets(merged, 6);
  for (const candidate of merged) {
    if (targets.length >= 8) break;
    if (candidate.externalSource === "tourapi" && !candidate.openingHours
      && !targets.includes(candidate)) targets.push(candidate);
  }
  // One bounded wave on shortlisted providers replaces up to four serial
  // overview batches followed by another detail batch. Hours also matter for
  // tourist attractions; images are already in search results and are optional.
  const signal = AbortSignal.timeout(4000);
  await Promise.all(targets.map(async candidate => {
    try {
      const detail = await loadTourPlaceDetail(candidate.externalPlaceId, candidate.category,
        candidate.tourContentTypeId, { includeImages: false, signal });
      if (!detail || signal.aborted) return;
      candidate.image = candidate.image || detail.image;
      candidate.openingHours = candidate.openingHours || detail.openingHours || undefined;
      const overview = detail.overview.trim();
      if (!overview) return;
      const excerpt = overview.length > 250
        ? overview.slice(0, 250).replace(/\s+\S*$/, "").trim() : overview;
      candidate.evidence = [...(candidate.evidence ?? []), {
        id: `tourapi:${candidate.externalPlaceId}:overview`, venueId: cacheKey(candidate),
        branchName: candidate.name, attribute: "experience", text: excerpt, sourceExcerpt: excerpt,
        sourceVenueName: candidate.name, sourceAddress: candidate.address,
        url: "https://www.data.go.kr/data/15101578/openapi.do",
        checkedAt: new Date().toISOString(), verification: "source_checked",
      }];
    } catch {
      // Optional provider enrichment must not discard otherwise valid venues.
    }
  }));
  return merged;
}

/** Cover different parts of the destination before filling remaining capacity. */
export function officialTourEvidenceTargets(candidates: DiscoverCandidate[], limit = 16) {
  const missing = candidates.filter(candidate => candidate.externalSource === "tourapi"
    && candidate.category === "tourist" && !candidate.evidence?.length && candidate.address);
  const chosen: DiscoverCandidate[] = [];
  const cells = new Set<string>();
  for (const candidate of missing) {
    const [lng, lat] = candidate.coordinates;
    const cell = `${Math.round(lng * 50)}:${Math.round(lat * 50)}`;
    if (cells.has(cell)) continue;
    cells.add(cell);
    chosen.push(candidate);
    if (chosen.length >= limit) return chosen;
  }
  for (const candidate of missing) {
    if (chosen.includes(candidate)) continue;
    chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen;
}
