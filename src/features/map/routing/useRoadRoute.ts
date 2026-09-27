"use client";

import { useEffect, useState } from "react";
import { encodeRouteCoords, fetchRoadRoute, type LngLat, type RoadRouteProfile } from "./fetchRoadRoute";

export function useRoadRoute(
  coordinates: LngLat[],
  enabled: boolean,
  profile: RoadRouteProfile = "driving",
) {
  const [resolved, setResolved] = useState<{ key: string; path: LngLat[] | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const routeKey = encodeRouteCoords(coordinates);

  useEffect(() => {
    if (!enabled || coordinates.length < 2) {
      setResolved(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResolved(null);

    void fetchRoadRoute(coordinates, profile).then(next => {
      if (cancelled) return;
      setResolved({ key: routeKey, path: next });
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, profile, routeKey, coordinates.length]);

  // A new day's coordinates must never briefly render the previous day's road path.
  const path = resolved?.key === routeKey ? resolved.path : null;
  return { path, loading, usesRoadNetwork: Boolean(path) };
}
