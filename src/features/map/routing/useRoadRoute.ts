"use client";

import { useEffect, useState } from "react";
import { encodeRouteCoords, fetchRoadRoute, type LngLat, type RoadRouteProfile } from "./fetchRoadRoute";

export function useRoadRoute(
  coordinates: LngLat[],
  enabled: boolean,
  profile: RoadRouteProfile = "driving",
) {
  const [path, setPath] = useState<LngLat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const routeKey = encodeRouteCoords(coordinates);

  useEffect(() => {
    if (!enabled || coordinates.length < 2) {
      setPath(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetchRoadRoute(coordinates, profile).then(next => {
      if (cancelled) return;
      setPath(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, profile, routeKey, coordinates.length]);

  return { path, loading, usesRoadNetwork: Boolean(path) };
}
