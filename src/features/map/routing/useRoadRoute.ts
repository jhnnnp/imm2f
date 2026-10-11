"use client";

import { useEffect, useState } from "react";
import { encodeRouteCoords, fetchRoadRoute, type LngLat, type RoadRouteProfile } from "./fetchRoadRoute";

export function useRoadRoute(coordinates: LngLat[], enabled: boolean, profile: RoadRouteProfile = "driving") {
  const [resolved, setResolved] = useState<{ key: string; path: LngLat[] | null } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const routeKey = `${profile}:${encodeRouteCoords(coordinates)}`;

  useEffect(() => {
    if (!enabled || coordinates.length < 2) {
      setResolved(null);
      setPendingKey(null);
      return;
    }

    const controller = new AbortController();
    setPendingKey(routeKey);
    setResolved(null);
    void fetchRoadRoute(coordinates, profile, controller.signal).then(path => {
      if (controller.signal.aborted) return;
      setResolved({ key: routeKey, path });
      setPendingKey(null);
    });
    return () => controller.abort();
    // The serialized key tracks coordinate values, independent of array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, routeKey]);

  const path = enabled && resolved?.key === routeKey ? resolved.path : null;
  return { path, loading: enabled && pendingKey === routeKey, usesRoadNetwork: Boolean(path) };
}
