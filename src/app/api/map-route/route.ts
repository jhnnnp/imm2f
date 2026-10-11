import { parseOsrmRoute, type LngLat, type RoadRouteProfile } from "@/features/map/routing/fetchRoadRoute";

const DRIVING_BASE = "https://router.project-osrm.org/route/v1/driving";
// A separately prepared pedestrian graph; OSRM's URL profile remains /driving.
const WALKING_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";

function parseCoordsParam(value: string | null): LngLat[] | null {
  if (!value || value.length > 4_096) return null;
  const parts = value.split("|");
  if (parts.length < 2 || parts.length > 50) return null;
  const coordinates: LngLat[] = [];
  for (const part of parts) {
    const pair = part.split(",").map(item => item.trim());
    if (pair.length !== 2 || pair.some(item => !item)) return null;
    const [lng, lat] = pair.map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    coordinates.push([lng, lat]);
  }
  return coordinates;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const coordinates = parseCoordsParam(url.searchParams.get("coords"));
  const profileParam = url.searchParams.get("profile") ?? "driving";
  if (!coordinates || (profileParam !== "foot" && profileParam !== "driving")) {
    return Response.json({ coordinates: [], error: "invalid_route" }, { status: 400 });
  }
  const profile: RoadRouteProfile = profileParam;
  const osrmPath = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  // Simplified overview prevents long trips from shipping tens of thousands of SVG points.
  const osrmUrl = `${profile === "foot" ? WALKING_BASE : DRIVING_BASE}/${osrmPath}?overview=simplified&geometries=geojson&steps=false`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, 6_000);
  try {
    const response = await fetch(osrmUrl, {
      headers: { Accept: "application/json", "User-Agent": "OnlyUsDatePlanner/0.2 (date itinerary routing)" },
      signal: controller.signal,
      next: { revalidate: 86400 },
    });
    if (!response.ok) return Response.json({ coordinates: [], error: "routing_failed" }, { status: 502 });
    const path = parseOsrmRoute(await response.json());
    if (!path) return Response.json({ coordinates: [], error: "no_route" }, { status: 404 });
    return Response.json({ coordinates: path, profile, provider: "OSRM/OpenStreetMap" }, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json({ coordinates: [], error: controller.signal.aborted ? "routing_timeout" : "routing_unreachable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}
