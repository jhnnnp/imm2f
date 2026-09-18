import type { Place, PlacePreferenceStatus } from "@/features/places/types/place";

export type PlacePinLabel = "want" | "visited" | "revisit";

export function normalizedPlaceLabel(status: PlacePreferenceStatus): PlacePinLabel | null {
  if (status === "want" || status === "must_visit") return "want";
  if (status === "visited") return "visited";
  if (status === "revisit") return "revisit";
  return null;
}

export function couplePlacePinLabel(place: Pick<Place, "userStatus" | "partnerStatus">): PlacePinLabel | null {
  return normalizedPlaceLabel(place.userStatus) ?? normalizedPlaceLabel(place.partnerStatus);
}

export function couplePlacePinFromPartner(place: Pick<Place, "userStatus" | "partnerStatus">) {
  return !normalizedPlaceLabel(place.userStatus) && Boolean(normalizedPlaceLabel(place.partnerStatus));
}
