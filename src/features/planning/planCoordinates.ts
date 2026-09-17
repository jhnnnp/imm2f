import { discoverPlaceId, parseDiscoverPlaceId } from "@/features/places/discover";
import type { PlanItem } from "./types/plan";

export function asPlanCoordinates(lng: unknown, lat: unknown): [number, number] | null {
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) return null;
  return [x, y];
}

export function isUuidPlaceId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export type PlaceCoordRow = {
  id: string;
  lng: number | null;
  lat: number | null;
  external_source?: string | null;
  external_place_id?: string | null;
};

export function placeCoordinateLookup(rows: PlaceCoordRow[]) {
  const lookup = new Map<string, [number, number]>();
  for (const row of rows) {
    const coords = asPlanCoordinates(row.lng, row.lat);
    if (!coords) continue;
    lookup.set(row.id, coords);
    const source = row.external_source === "tourapi" || row.external_source === "kakao" ? row.external_source : null;
    if (source && row.external_place_id) {
      lookup.set(discoverPlaceId(source, row.external_place_id), coords);
    }
  }
  return lookup;
}

export function withLookedUpCoordinates(items: PlanItem[], lookup: Map<string, [number, number]>): PlanItem[] {
  return items.map(item => {
    const existing = asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]);
    if (existing) return { ...item, coordinates: existing };
    const parsed = parseDiscoverPlaceId(item.placeId);
    const found = lookup.get(item.placeId)
      ?? (parsed ? lookup.get(discoverPlaceId(parsed.source, parsed.externalPlaceId)) : undefined);
    return { ...item, coordinates: found ?? null };
  });
}

export function regionHintFromTitle(title: string) {
  return title.replace(/\s*(여행|데이트|코스)$/u, "").trim();
}

export function planItemLngLat(item: PlanItem) {
  const coords = asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]);
  return { lng: coords?.[0] ?? null, lat: coords?.[1] ?? null };
}

export function pickResolvedCoordinates(
  item: PlanItem,
  candidates: Array<{ externalPlaceId: string; name: string; coordinates: [number, number] }>,
) {
  const parsed = parseDiscoverPlaceId(item.placeId);
  const byId = parsed ? candidates.find(place => place.externalPlaceId === parsed.externalPlaceId) : undefined;
  if (byId) return byId.coordinates;
  const byName = candidates.find(place => place.name === item.placeName);
  return byName?.coordinates ?? candidates[0]?.coordinates ?? null;
}
