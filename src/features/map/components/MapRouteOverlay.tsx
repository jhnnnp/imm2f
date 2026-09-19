"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { curveRoute } from "@/features/trip/planRoute";
import type { LngLat, RoadRouteProfile } from "@/features/map/routing/fetchRoadRoute";
import { useRoadRoute } from "@/features/map/routing/useRoadRoute";

export type RouteAnchor = {
  coordinates: LngLat;
  /** Marker DOM offset (px), e.g. stacked pins on CoupleMap */
  screenOffset?: [number, number];
  /** Nudge line endpoint to visual pin tip (px), from MapLibre anchor point */
  tipOffset?: [number, number];
};

function projectAnchor(map: MapLibreMap, anchor: RouteAnchor) {
  const point = map.project(anchor.coordinates);
  const [ox = 0, oy = 0] = anchor.screenOffset ?? [];
  const [tx = 0, ty = 0] = anchor.tipOffset ?? [];
  return { x: point.x + ox + tx, y: point.y + oy + ty };
}

function screenPathFromCoords(map: MapLibreMap, anchors: RouteAnchor[], routeCoords: LngLat[]) {
  if (routeCoords.length < 2) return "";
  const projected = routeCoords.map(coord => {
    const point = map.project(coord);
    return { x: point.x, y: point.y };
  });
  projected[0] = projectAnchor(map, anchors[0]);
  projected[projected.length - 1] = projectAnchor(map, anchors[anchors.length - 1]);
  return projected.map(point => `${point.x},${point.y}`).join(" ");
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

    parts.push(projected.map(point => `${point.x},${point.y}`).join(" "));
  }

  return parts.join(" ");
}

export function MapRouteOverlay({
  map,
  anchors,
  active,
  className = "map-route-overlay",
  pinVariant = "memory",
  roadProfile = "driving",
  /** When provided, skip an internal road-route fetch (parent already resolved it). */
  roadPath: roadPathProp,
  roadLoading: roadLoadingProp,
}: {
  map: MapLibreMap | null;
  anchors: RouteAnchor[];
  active: boolean;
  className?: string;
  pinVariant?: "memory" | "planner";
  roadProfile?: RoadRouteProfile;
  roadPath?: LngLat[] | null;
  roadLoading?: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const routeKey = useMemo(
    () => anchors.map(anchor => `${anchor.coordinates.join(",")}:${anchor.screenOffset?.join(",") ?? ""}:${anchor.tipOffset?.join(",") ?? ""}`).join("|"),
    [anchors],
  );
  const [path, setPath] = useState("");

  const normalizedAnchors = useMemo(
    () => anchors.map(anchor => ({
      ...anchor,
      tipOffset: anchor.tipOffset ?? (pinVariant === "planner" ? ([0, -5] as [number, number]) : ([0, -2] as [number, number])),
    })),
    [anchors, pinVariant],
  );

  const coordinateList = useMemo(
    () => normalizedAnchors.map(anchor => anchor.coordinates),
    [normalizedAnchors],
  );

  const fetchEnabled = active && roadPathProp === undefined && coordinateList.length >= 2;
  const { path: fetchedPath, loading: fetchedLoading, usesRoadNetwork: fetchedUsesRoad } = useRoadRoute(
    coordinateList,
    fetchEnabled,
    roadProfile,
  );
  const roadPath = roadPathProp !== undefined ? roadPathProp : fetchedPath;
  const roadLoading = roadLoadingProp !== undefined ? roadLoadingProp : fetchedLoading;
  const usesRoadNetwork = roadPathProp !== undefined ? Boolean(roadPathProp) : fetchedUsesRoad;

  useEffect(() => {
    if (!map || !active || normalizedAnchors.length < 2) {
      setPath("");
      return;
    }

    let frame = 0;
    const syncNow = () => {
      if (roadPath) {
        setPath(screenPathFromCoords(map, normalizedAnchors, roadPath));
        return;
      }
      setPath(buildScreenPath(map, normalizedAnchors));
    };
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncNow);
    };

    syncNow();
    map.on("move", sync);
    map.on("zoom", sync);
    map.on("resize", sync);
    map.on("rotate", sync);
    map.on("pitch", sync);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("move", sync);
      map.off("zoom", sync);
      map.off("resize", sync);
      map.off("rotate", sync);
      map.off("pitch", sync);
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
