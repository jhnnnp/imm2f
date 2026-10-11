"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { curveRoute } from "@/features/trip/planRoute";
import { isLngLat, type LngLat, type RoadRouteProfile } from "@/features/map/routing/fetchRoadRoute";
import { useRoadRoute } from "@/features/map/routing/useRoadRoute";

export type RouteAnchor = {
  coordinates: LngLat;
};

function projectAnchor(map: MapLibreMap, anchor: RouteAnchor) {
  return map.project(anchor.coordinates);
}

function screenPathFromCoords(map: MapLibreMap, anchors: RouteAnchor[], routeCoords: LngLat[]) {
  if (routeCoords.length < 2) return "";
  const projected = routeCoords.map(coord => {
    const point = map.project(coord);
    return { x: point.x, y: point.y };
  });
  projected[0] = projectAnchor(map, anchors[0]);
  projected[projected.length - 1] = projectAnchor(map, anchors[anchors.length - 1]);
  return projected.map(point => `${Number(point.x.toFixed(2))},${Number(point.y.toFixed(2))}`).join(" ");
}

/** Fallback while road route loads or when routing fails */
export function buildScreenPath(map: MapLibreMap, anchors: RouteAnchor[]) {
  if (anchors.length < 2) return "";

  const parts: string[] = [];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    const segment = curveRoute([start.coordinates, end.coordinates], 14);
    const projected = segment.map(coord => {
      const point = map.project(coord);
      return { x: point.x, y: point.y };
    });

    if (!projected.length) continue;

    projected[0] = projectAnchor(map, start);
    projected[projected.length - 1] = projectAnchor(map, end);

    parts.push(projected.map(point => `${Number(point.x.toFixed(2))},${Number(point.y.toFixed(2))}`).join(" "));
  }

  return parts.join(" ");
}

export function MapRouteOverlay({
  map,
  anchors,
  active,
  className = "map-route-overlay",
  roadProfile = "driving",
  providedRoadPath,
}: {
  map: MapLibreMap | null;
  anchors: RouteAnchor[];
  active: boolean;
  className?: string;
  roadProfile?: RoadRouteProfile;
  /** Reuse a parent's route fetch when the map and overlay share a path. */
  providedRoadPath?: LngLat[] | null;
}) {
  const gradientId = useId().replace(/:/g, "");
  const routeKey = useMemo(
    () => `${roadProfile}:` + anchors.map(anchor => anchor.coordinates.join(",")).join("|"),
    [anchors, roadProfile],
  );
  const [projected, setProjected] = useState<{ key: string; path: string } | null>(null);
  const path = projected?.key === routeKey ? projected.path : "";

  const normalizedAnchors = useMemo(
    () => anchors.filter(anchor => isLngLat(anchor.coordinates)),
    [anchors],
  );

  const coordinateList = useMemo(
    () => normalizedAnchors.map(anchor => anchor.coordinates),
    [normalizedAnchors],
  );

  const { path: fetchedRoadPath, loading: fetchedRoadLoading } = useRoadRoute(
    coordinateList,
    active && coordinateList.length >= 2 && providedRoadPath === undefined,
    roadProfile,
  );
  const roadPath = providedRoadPath === undefined ? fetchedRoadPath : providedRoadPath;
  const roadLoading = providedRoadPath === undefined && fetchedRoadLoading;
  const usesRoadNetwork = Boolean(roadPath);

  useEffect(() => {
    if (!map || !active || normalizedAnchors.length < 2) {
      setProjected(null);
      return;
    }
    let frame = 0;
    const sync = () => {
      const next = roadPath
        ? screenPathFromCoords(map, normalizedAnchors, roadPath)
        : buildScreenPath(map, normalizedAnchors);
      setProjected(current => current?.key === routeKey && current.path === next ? current : { key: routeKey, path: next });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; sync(); });
    };
    sync();
    // move covers pan, zoom, pitch and bearing; project the route once per frame.
    map.on("move", schedule);
    map.on("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("move", schedule);
      map.off("resize", schedule);
    };
  }, [map, active, normalizedAnchors, routeKey, roadPath]);

  if (!active || !path) return null;

  const overlayClass = [
    className,
    usesRoadNetwork ? "is-road" : "is-fallback",
    roadLoading ? "is-loading" : "",
  ].filter(Boolean).join(" ");

  return (
    <svg className={overlayClass} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="280" y2="0">
          <stop offset="0%" stopColor="#faf6dc" />
          <stop offset="42%" stopColor="#ebe68f" />
          <stop offset="100%" stopColor="#dfe9b8" />
        </linearGradient>
        <filter id={`${gradientId}-depth`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#7a7448" floodOpacity="0.22" />
        </filter>
      </defs>
      <polyline className="map-route-overlay-ground" points={path} />
      <polyline className="map-route-overlay-body" points={path} stroke={`url(#${gradientId})`} filter={`url(#${gradientId}-depth)`} />
      <polyline className="map-route-overlay-sheen" points={path} />
      <polyline className="map-route-overlay-flow" points={path} />
    </svg>
  );
}

export function coordinatesToAnchors(coordinates: LngLat[]): RouteAnchor[] {
  return coordinates.map(coord => ({ coordinates: coord }));
}
