"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PlanItem } from "@/features/planning/types/plan";
import { htmlMarkerPlacement } from "@/features/map/htmlMarker";
import { emptyGeoJsonSource, memoryCityStyle } from "@/features/map/memoryCityStyle";
import { cinematicBearing } from "../planRoute";
import { MapRouteOverlay } from "@/features/map/components/MapRouteOverlay";
import { useRoadRoute } from "@/features/map/routing/useRoadRoute";
import { planItemsWithCoordinates, syncPlanMapRoadRoute, syncPlanMapRoute } from "./planMapRoute";

const MAP_PITCH = 44;

const MAP_STYLE: StyleSpecification = memoryCityStyle({
  sources: {
    "plan-route": emptyGeoJsonSource(true),
    "plan-route-segments": emptyGeoJsonSource(true),
    "plan-route-aura": emptyGeoJsonSource(),
    "plan-route-body": emptyGeoJsonSource(),
    "plan-route-core": emptyGeoJsonSource(),
    "plan-route-stops": emptyGeoJsonSource(),
    "plan-route-nodes": emptyGeoJsonSource(),
  },
  layers: [
    {
      id: "plan-route-track-shadow",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#faf7e8",
        "line-opacity": 0.94,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 12, 16, 16],
      },
    },
    {
      id: "plan-route-track",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#e3de96",
        "line-opacity": 0.9,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 12, 6.5, 16, 8.5],
      },
    },
    {
      id: "plan-route-track-inner",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#f3f0cc",
        "line-opacity": 0.82,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 12, 2.8, 16, 3.4],
      },
    },
    {
      id: "plan-route-flow",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#fffef5",
        "line-opacity": 0.65,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 1.4, 16, 1.8],
        "line-dasharray": [1.2, 2.8],
      },
    },
    {
      id: "plan-route-leg",
      type: "line",
      source: "plan-route-segments",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#c8c088",
        "line-opacity": 0.18,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 11, 16, 14],
      },
    },
  ],
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export function PlanMap({ items, dayLabel, expanded = false }: { items: PlanItem[]; dayLabel?: string; expanded?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const locatedRef = useRef<Array<PlanItem & { coordinates: [number, number] }>>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const located = useMemo(() => planItemsWithCoordinates(items), [items]);
  const routeKey = useMemo(
    () => located.map(item => `${item.id}:${item.placeName}:${item.coordinates[0]},${item.coordinates[1]}`).join("|"),
    [located],
  );
  const coordinateList = useMemo(() => located.map(item => item.coordinates), [located]);
  const { path: roadPath } = useRoadRoute(coordinateList, ready && coordinateList.length >= 2, "driving");
  locatedRef.current = located;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let bootFrame = 0;
    let readyTimer = 0;
    const start = locatedRef.current[0]?.coordinates ?? [126.978, 37.5665];
    setReady(false);
    setError(false);

    const boot = () => {
      void import("maplibre-gl")
        .then(maplibregl => {
          if (disposed || !container.current || mapRef.current) return;
          try {
            const map = new maplibregl.Map({
              container: container.current,
              pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
              style: MAP_STYLE,
              center: start,
              zoom: 13,
              pitch: MAP_PITCH,
              bearing: cinematicBearing(locatedRef.current.map(item => item.coordinates)),
              maxPitch: 60,
              attributionControl: false,
              renderWorldCopies: false,
              fadeDuration: 0,
              refreshExpiredTiles: false,
              maxTileCacheSize: 64,
              canvasContextAttributes: { antialias: false, powerPreference: "low-power" },
            });
            mapRef.current = map;
            setMapInstance(map);
            map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
            const resizeIfVisible = () => {
              const node = container.current;
              if (!node || node.clientWidth < 8 || node.clientHeight < 8) return;
              map.resize();
            };
            resizeObserver = new ResizeObserver(resizeIfVisible);
            resizeObserver.observe(container.current);
            let finished = false;
            const finishLoad = () => {
              if (disposed || finished) return;
              finished = true;
              window.clearTimeout(readyTimer);
              resizeIfVisible();
              syncPlanMapRoute(map, locatedRef.current.map(item => item.coordinates));
              setReady(true);
            };
            map.once("style.load", () => {
              resizeIfVisible();
              syncPlanMapRoute(map, locatedRef.current.map(item => item.coordinates));
              map.once("idle", finishLoad);
              readyTimer = window.setTimeout(finishLoad, 800);
            });
            map.on("webglcontextlost", event => {
              event.originalEvent?.preventDefault();
              if (!disposed) setError(true);
            });
            map.on("webglcontextrestored", () => {
              if (disposed) return;
              setError(false);
              resizeIfVisible();
            });
          } catch {
            if (!disposed) setError(true);
          }
        })
        .catch(() => {
          if (!disposed) setError(true);
        });
    };

    bootFrame = window.requestAnimationFrame(() => {
      bootFrame = window.requestAnimationFrame(boot);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(bootFrame);
      window.clearTimeout(readyTimer);
      resizeObserver?.disconnect();
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || error) return;
    const current = locatedRef.current;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !mapRef.current) return;
      map.resize();
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      if (!current.length) {
        syncPlanMapRoute(map, []);
        return;
      }
      if (roadPath) syncPlanMapRoadRoute(map, roadPath);
      else syncPlanMapRoute(map, current.map(item => item.coordinates));
      markersRef.current = current.map((item, index) => {
        const element = document.createElement("button");
        element.className = "plan-map-marker";
        element.type = "button";
        element.innerHTML = `<span><i>${index + 1}</i></span><b>${escapeHtml(item.placeName)}</b>`;
        element.setAttribute("aria-label", `${index + 1}. ${item.placeName}`);
        return new maplibregl.Marker({ element, ...htmlMarkerPlacement }).setLngLat(item.coordinates).addTo(map);
      });
      const bearing = cinematicBearing(current.map(item => item.coordinates));
      const frame = (center: [number, number], zoom: number) => {
        map.easeTo({ center, zoom, pitch: MAP_PITCH, bearing, duration: 850 });
      };
      if (current.length === 1) frame(current[0].coordinates, 14.2);
      else {
        const compact = map.getContainer().clientWidth < 420;
        const bounds = current.slice(1).reduce((next, item) => next.extend(item.coordinates), new maplibregl.LngLatBounds(current[0].coordinates, current[0].coordinates));
        const fitted = map.cameraForBounds(bounds, {
          padding: compact ? { top: 48, bottom: 42, left: 36, right: 36 } : { top: 88, bottom: 96, left: 72, right: 88 },
          maxZoom: 13.3,
          bearing,
        });
        if (fitted?.center && typeof fitted.zoom === "number") {
          const center = maplibregl.LngLat.convert(fitted.center);
          frame([center.lng, center.lat], fitted.zoom);
        } else {
          frame(current[0].coordinates, 13);
        }
      }
    });
    return () => { disposed = true; };
  }, [ready, routeKey, roadPath, error]);

  return <section className={`planner-map${expanded ? " is-expanded" : ""}`} aria-label={`${dayLabel ?? "여행"} 지도`}>
    <div ref={container} className="maplibre-canvas" />
    <MapRouteOverlay
      map={mapInstance}
      anchors={located.map(item => ({ coordinates: item.coordinates }))}
      pinVariant="planner"
      active={ready && located.length >= 2}
    />
    {!located.length && <div className="map-unavailable is-overlay"><div><b>표시할 좌표가 없어요</b><span>장소를 담으면 실제 지도와 동선이 보여요.</span></div></div>}
    {located.length > 0 && !ready && !error && <div className="map-loading"><span>여행 지도를 펼치고 있어요.</span><i /></div>}
    {located.length > 0 && error && <div className="map-error"><b>지도를 불러오지 못했어요</b><span>장소와 일정은 그대로 저장되어 있어요.</span><button type="button" className="outline-button" onClick={() => setAttempt(value => value + 1)}>지도 다시 열기</button></div>}
    {located.length > 0 && <div className="map-summary"><span>{dayLabel ?? "DAY 1"}</span><b>{located.length}곳</b><small>번호 순서대로 동선이 이어져요</small></div>}
  </section>;
}
