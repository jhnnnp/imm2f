export type RoadRouteProfile = "driving" | "foot";
export type LngLat = [number, number];

const ROUTE_TIMEOUT_MS = 8_000;
const ROUTE_CACHE_TTL_MS = 5 * 60_000;
const routeCache = new Map<string, { path: LngLat[]; expiresAt: number }>();

/** Reject missing/coerced coordinates before passing data to a map or router. */
export function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180
    && typeof value[1] === "number" && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

function validRoutePath(value: unknown): LngLat[] | null {
  return Array.isArray(value) && value.length >= 2 && value.length <= 50_000
    && value.every(isLngLat) ? value : null;
}

export function encodeRouteCoords(coordinates: LngLat[]) {
  return coordinates.map(([lng, lat]) => `${lng},${lat}`).join("|");
}

/** Routing is optional: transport/JSON failures must leave a usable fallback map. */
export async function fetchRoadRoute(
  coordinates: LngLat[],
  profile: RoadRouteProfile = "driving",
  signal?: AbortSignal,
): Promise<LngLat[] | null> {
  if (signal?.aborted || coordinates.length < 2 || coordinates.length > 50 || !coordinates.every(isLngLat)) return null;

  const key = `${profile}:${encodeRouteCoords(coordinates)}`;
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.path;
  if (cached) routeCache.delete(key);

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, ROUTE_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ coords: encodeRouteCoords(coordinates), profile });
    const response = await fetch(`/api/map-route?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const path = validRoutePath(payload && typeof payload === "object" && "coordinates" in payload ? payload.coordinates : null);
    if (!path || controller.signal.aborted) return null;
    if (routeCache.size >= 64) routeCache.delete(routeCache.keys().next().value!);
    routeCache.set(key, { path, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
    return path;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function parseOsrmRoute(payload: unknown): LngLat[] | null {
  if (!payload || typeof payload !== "object" || !("routes" in payload) || !Array.isArray(payload.routes)) return null;
  if ("code" in payload && payload.code !== "Ok") return null;
  const first: unknown = payload.routes[0];
  if (!first || typeof first !== "object" || !("geometry" in first)) return null;
  const geometry = first.geometry;
  return geometry && typeof geometry === "object" && "coordinates" in geometry ? validRoutePath(geometry.coordinates) : null;
}
