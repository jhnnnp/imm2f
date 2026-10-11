export const LEGACY_DEMO_PLACES = [
  { name: "카페 라파르", lng: 126.7086, lat: 35.9879 },
  { name: "초원사진관", lng: 126.7108, lat: 35.9892 },
  { name: "은파호수공원", lng: 126.6894, lat: 35.9553 },
  { name: "이성당", lng: 126.7116, lat: 35.9871 },
  { name: "마리서사", lng: 126.7049, lat: 35.9898 },
  { name: "한주옥", lng: 126.7082, lat: 35.9906 },
] as const;

function sameCoord(left: number | null | undefined, right: number) {
  return left != null && Number.isFinite(left) && Math.abs(left - right) < 1e-4;
}

export function isLegacyDemoPlace(place: {
  name: string;
  lng: number | null;
  lat: number | null;
  external_source?: string | null;
  external_place_id?: string | null;
}) {
  if (place.external_source && place.external_source !== "manual") return false;
  if (place.external_place_id) return false;
  return LEGACY_DEMO_PLACES.some(demo =>
    demo.name === place.name && sameCoord(place.lng, demo.lng) && sameCoord(place.lat, demo.lat)
  );
}

// A name and coordinate match is useful for recognizing the old sample list,
// but cannot prove that a row was seeded. Never delete saved places using it.
