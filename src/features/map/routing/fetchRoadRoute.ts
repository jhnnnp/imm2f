export type RoadRouteProfile = "driving" | "foot";

export type LngLat = [number, number];

type OsrmResponse = {
  routes?: Array<{
    geometry?: {
      coordinates?: LngLat[];
    };
  }>;
  code?: string;
};

export function encodeRouteCoords(coordinates: LngLat[]) {
  return coordinates.map(([lng, lat]) => `${lng},${lat}`).join("|");
}

export async function fetchRoadRoute(
  coordinates: LngLat[],
  profile: RoadRouteProfile = "driving",
): Promise<LngLat[] | null> {
  if (coordinates.length < 2) return null;

  const params = new URLSearchParams({
    coords: encodeRouteCoords(coordinates),
    profile,
  });

  const response = await fetch(`/api/map-route?${params.toString()}`);
  if (!response.ok) return null;

  const payload = (await response.json()) as { coordinates?: LngLat[] };
  const path = payload.coordinates;
  if (!path || path.length < 2) return null;
  return path;
}

export function parseOsrmRoute(payload: OsrmResponse): LngLat[] | null {
  const path = payload.routes?.[0]?.geometry?.coordinates;
  if (!path || path.length < 2) return null;
  return path;
}
