import { visualToneForCategory } from "./mappers";
import type { DiscoverCandidate, Place } from "./types/place";

export const DISCOVER_ID_PREFIX = "discover:";

export function discoverPlaceId(source: "kakao" | "tourapi", externalPlaceId: string) {
  return `${DISCOVER_ID_PREFIX}${source}:${externalPlaceId}`;
}

export function parseDiscoverPlaceId(id: string): { source: "kakao" | "tourapi"; externalPlaceId: string } | null {
  if (!id.startsWith(DISCOVER_ID_PREFIX)) return null;
  const rest = id.slice(DISCOVER_ID_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const source = rest.slice(0, sep);
  const externalPlaceId = rest.slice(sep + 1).trim();
  if ((source !== "kakao" && source !== "tourapi") || !externalPlaceId) return null;
  return { source, externalPlaceId };
}

export function isDiscoverPlace(place: Place) {
  return place.id.startsWith(DISCOVER_ID_PREFIX);
}

export function candidateToPlace(candidate: DiscoverCandidate, extras?: { userFit?: number; partnerFit?: number; recommendReason?: string }): Place {
  const source = candidate.externalSource === "tourapi" ? "tourapi" : "kakao";
  return {
    id: discoverPlaceId(source, candidate.externalPlaceId),
    name: candidate.name,
    category: candidate.category,
    categoryLabel: candidate.categoryLabel,
    district: candidate.district,
    address: candidate.address,
    roadAddress: candidate.roadAddress,
    mapUrl: candidate.mapUrl,
    phone: candidate.phone,
    description: extras?.recommendReason || "",
    durationMinutes: 60,
    expectedCostTwo: null,
    coordinates: candidate.coordinates,
    image: candidate.image,
    visualTone: visualToneForCategory(candidate.category),
    userStatus: "neutral",
    partnerStatus: "neutral",
    userFit: extras?.userFit ?? 0,
    partnerFit: extras?.partnerFit ?? 0,
    externalSource: source,
    externalPlaceId: candidate.externalPlaceId,
    recommendReason: extras?.recommendReason,
    detailedCategory: candidate.detailedCategory,
    kakaoCategoryGroupCode: candidate.kakaoCategoryGroupCode,
    distanceMeters: candidate.distanceMeters,
    openingHours: candidate.openingHours ?? null,
  };
}

export function placeToCandidate(place: Place): DiscoverCandidate | null {
  if (!place.externalPlaceId || !place.coordinates) return null;
  return {
    externalSource: place.externalSource === "tourapi" ? "tourapi" : "kakao",
    externalPlaceId: place.externalPlaceId,
    name: place.name,
    category: place.category,
    categoryLabel: place.categoryLabel,
    district: place.district,
    address: place.address ?? "",
    roadAddress: place.roadAddress ?? "",
    phone: place.phone ?? "",
    mapUrl: place.mapUrl ?? "",
    coordinates: place.coordinates,
    image: place.image,
    detailedCategory: place.detailedCategory,
    kakaoCategoryGroupCode: place.kakaoCategoryGroupCode,
    distanceMeters: place.distanceMeters,
    openingHours: place.openingHours ?? undefined,
    expectedCostTwo: place.expectedCostTwo,
  };
}

export function mergeCandidateWithSaved(candidate: DiscoverCandidate, saved: Place[], extras?: { userFit?: number; partnerFit?: number; recommendReason?: string }): Place {
  const source = candidate.externalSource === "tourapi" ? "tourapi" : "kakao";
  const match = saved.find(place => place.externalSource === source && place.externalPlaceId === candidate.externalPlaceId);
  if (match) {
    return extras ? { ...match, userFit: extras.userFit ?? match.userFit, partnerFit: extras.partnerFit ?? match.partnerFit, recommendReason: extras.recommendReason || match.recommendReason } : match;
  }
  return candidateToPlace(candidate, extras);
}

export function uniqueByExternalId(places: Place[]) {
  const seen = new Set<string>();
  return places.filter(place => {
    const key = `${place.externalSource ?? "manual"}:${place.externalPlaceId || place.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
