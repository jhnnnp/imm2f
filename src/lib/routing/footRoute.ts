import { distanceMeters } from "@/features/places/geo";

export type FootLeg = { meters: number; seconds: number };
export type FootRoute = { legs: FootLeg[]; meters: number; seconds: number; provider: "osm_foot" };
type LngLat = [number, number];
const BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 256;
const cache = new Map<string, { expiresAt: number; route: FootRoute }>();
const inFlight = new Map<string, Promise<FootRoute | null>>();

function untilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const abort = () => resolve(null);
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(resolve, () => resolve(null))
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function parseFootRoute(raw: unknown, coordinates: LngLat[]): FootRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const response = raw as { code?: unknown; routes?: Array<{ distance?: unknown; duration?: unknown; legs?: Array<{ distance?: unknown; duration?: unknown }> }> };
  const route = response.routes?.[0];
  if (response.code !== "Ok" || !route || route.legs?.length !== coordinates.length - 1) return null;
  const legs = route.legs.map(leg => ({ meters: Number(leg.distance), seconds: Number(leg.duration) }));
  if (legs.some((leg, index) => !Number.isFinite(leg.meters) || !Number.isFinite(leg.seconds)
    || leg.meters < Math.max(0, distanceMeters(coordinates[index], coordinates[index + 1]) * 0.85)
    || leg.meters > 50_000 || leg.seconds < 0)) return null;
  return { legs, meters: legs.reduce((sum, leg) => sum + leg.meters, 0),
    seconds: legs.reduce((sum, leg) => sum + leg.seconds, 0), provider: "osm_foot" };
}

/** Dedicated pedestrian graph. OSRM's /foot path on the car demo is not a foot graph. */
export async function fetchFootRoute(coordinates: LngLat[], requestSignal?: AbortSignal): Promise<FootRoute | null> {
  if (requestSignal?.aborted || coordinates.length < 2 || coordinates.length > 7
    || coordinates.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat)
      || Math.abs(lng) > 180 || Math.abs(lat) > 90)) return null;
  const key = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.route;
  let pending = inFlight.get(key);
  if (!pending) {
    const signal = AbortSignal.timeout(6000);
    pending = untilAbort((async () => {
      const response = await fetch(`${BASE}/${key}?overview=false&steps=false`, {
        headers: { Accept: "application/json", "User-Agent": "OnlyUsDatePlanner/0.2 (date itinerary routing)" },
        signal,
        next: { revalidate: 86400 },
      });
      if (!response.ok) return null;
      const route = parseFootRoute(await response.json(), coordinates);
      signal.throwIfAborted();
      if (!route) return null;
      cache.set(key, { route, expiresAt: Date.now() + TTL_MS });
      if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
      return route;
    })(), signal).finally(() => { inFlight.delete(key); });
    inFlight.set(key, pending);
  }
  // One canceled caller cannot cancel a route shared by another request.
  return requestSignal ? untilAbort(pending, requestSignal) : pending;
}
