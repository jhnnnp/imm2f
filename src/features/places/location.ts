import { districtFromAddress, searchKakaoPlacesRemote } from "@/lib/kakao/local";
import type { KakaoPlaceCandidate, Place } from "./types/place";

export type PlaceLocationPatch = {
  address: string;
  roadAddress: string;
  district: string;
  coordinates: [number, number] | null;
  mapUrl?: string;
};

export type PlaceLocationInput = {
  address: string;
  district?: string;
};

export function pickKakaoLocationHit(places: KakaoPlaceCandidate[], name: string) {
  const needle = name.replace(/\s+/g, "");
  if (!places.length) return null;
  if (!needle) return places[0];
  return places.find(place => {
    const candidate = place.name.replace(/\s+/g, "");
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  }) ?? places[0];
}

export function locationQueries(name: string, address: string) {
  const trimmedName = name.trim();
  const trimmedAddress = address.trim();
  return [...new Set([
    [trimmedName, trimmedAddress].filter(Boolean).join(" "),
    trimmedAddress,
    trimmedName,
  ].filter(query => query.length >= 2))];
}

export async function resolvePlaceLocation(name: string, input: PlaceLocationInput): Promise<PlaceLocationPatch> {
  const address = input.address.trim();
  const district = input.district?.trim() ?? "";
  for (const query of locationQueries(name, address)) {
    const result = await searchKakaoPlacesRemote({ query });
    if (!result.ok || !result.places.length) continue;
    const hit = pickKakaoLocationHit(result.places, name);
    if (!hit) continue;
    return {
      address: hit.address || address,
      roadAddress: hit.roadAddress || "",
      district: district || hit.district || districtFromAddress(hit.roadAddress || hit.address || address),
      coordinates: hit.coordinates,
      mapUrl: hit.mapUrl || undefined,
    };
  }
  return {
    address,
    roadAddress: "",
    district: district || districtFromAddress(address),
    coordinates: null,
  };
}

export function applyPlaceLocation(place: Place, patch: PlaceLocationPatch): Place {
  return {
    ...place,
    address: patch.address || place.address,
    roadAddress: patch.roadAddress || place.roadAddress,
    district: patch.district || place.district,
    coordinates: patch.coordinates ?? place.coordinates,
    mapUrl: place.externalSource === "kakao" && patch.mapUrl ? patch.mapUrl : place.mapUrl,
  };
}
