import { parseOsrmRoute, type LngLat, type RoadRouteProfile } from "@/features/map/routing/fetchRoadRoute";

const OSRM_BASE = "https://router.project-osrm.org/route/v1";

function parseCoordsParam(value: string | null): LngLat[] {
  if (!value) return [];
  return value
    .split("|")
    .map(part => part.trim())
    .flatMap(part => {
      const [lngRaw, latRaw] = part.split(",").map(item => Number(item.trim()));
      if (!Number.isFinite(lngRaw) || !Number.isFinite(latRaw)) return [];
      if (Math.abs(lngRaw) > 180 || Math.abs(latRaw) > 90) return [];
      return [[lngRaw, latRaw] as LngLat];
    });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const coordinates = parseCoordsParam(url.searchParams.get("coords"));
  const profileParam = url.searchParams.get("profile");
  const profile: RoadRouteProfile = profileParam === "foot" ? "foot" : "driving";

  if (coordinates.length < 2) {
    return Response.json({ coordinates: [] });
  }

  const osrmPath = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const osrmUrl = `${OSRM_BASE}/${profile}/${osrmPath}?overview=full&geometries=geojson&steps=false`;

  try {
    const response = await fetch(osrmUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return Response.json({ coordinates: [], error: "routing_failed" }, { status: 502 });
    }

    const payload = await response.json();
    const path = parseOsrmRoute(payload);
    if (!path) {
      return Response.json({ coordinates: [], error: "no_route" }, { status: 404 });
    }

    return Response.json(
      { coordinates: path, profile },
      { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return Response.json({ coordinates: [], error: "routing_unreachable" }, { status: 502 });
  }
}
