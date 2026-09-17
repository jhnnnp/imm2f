"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PlanItem } from "@/features/planning/types/plan";
import { htmlMarkerPlacement } from "@/features/map/htmlMarker";
import { cinematicBearing } from "../planRoute";
import { MapRouteOverlay } from "@/features/map/components/MapRouteOverlay";
import { useRoadRoute } from "@/features/map/routing/useRoadRoute";
import { planItemsWithCoordinates, syncPlanMapRoadRoute, syncPlanMapRoute } from "./planMapRoute";

const MAP_PITCH = 60;
const EMPTY_ROUTE = () => ({ type: "FeatureCollection" as const, features: [] });

const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  light: {
    anchor: "viewport",
    color: "#fff1d6",
    intensity: 0.64,
    position: [1.45, 208, 18],
  },
  sky: {
    "sky-color": "#b7c7bf",
    "horizon-color": "#e4ece6",
    "sky-horizon-blend": 0.72,
  },
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
    "plan-route": { type: "geojson", data: EMPTY_ROUTE(), lineMetrics: true, tolerance: 0 },
    "plan-route-segments": { type: "geojson", data: EMPTY_ROUTE(), lineMetrics: true, tolerance: 0 },
    "plan-route-aura": { type: "geojson", data: EMPTY_ROUTE(), tolerance: 0 },
    "plan-route-body": { type: "geojson", data: EMPTY_ROUTE(), tolerance: 0 },
    "plan-route-core": { type: "geojson", data: EMPTY_ROUTE(), tolerance: 0 },
    "plan-route-stops": { type: "geojson", data: EMPTY_ROUTE(), tolerance: 0 },
    "plan-route-nodes": { type: "geojson", data: EMPTY_ROUTE() },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#c5d0ca" } },
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-opacity": 0.52,
        "raster-saturation": -0.72,
        "raster-contrast": -0.12,
        "raster-brightness-min": 0.08,
        "raster-brightness-max": 0.82,
      },
    },
    {
      id: "plan-route-track-shadow",
      type: "line",
      source: "plan-route",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
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
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
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
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
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
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
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
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#c8c088",
        "line-opacity": 0.18,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 11, 16, 14],
      },
    },
    {
      id: "plan-route-arrows",
      type: "symbol",
      source: "plan-route-segments",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 64,
        "text-field": "›",
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 14,
        "text-keep-upright": false,
        "text-rotation-alignment": "map",
      },
      paint: {
        "text-color": "#fffaf2",
        "text-halo-color": "rgba(47, 70, 60, 0.92)",
        "text-halo-width": 1.6,
      },
    },
  ],
};

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
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const located = planItemsWithCoordinates(items);
  const routeKey = located.map(item => `${item.coordinates[0]},${item.coordinates[1]}`).join("|");
  const coordinateList = useMemo(() => located.map(item => item.coordinates), [located]);
  const { path: roadPath } = useRoadRoute(coordinateList, ready && coordinateList.length >= 2, "driving");
  locatedRef.current = located;

  useEffect(() => {
    if (!container.current || mapRef.current || !located.length) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let flowFrame = 0;
    setReady(false);
    setError(false);
    void import("maplibre-gl")
      .then(maplibregl => {
        if (disposed || !container.current) return;
        try {
          const map = new maplibregl.Map({
            container: container.current,
            style: MAP_STYLE,
            center: located[0].coordinates,
            zoom: 13,
            pitch: MAP_PITCH,
            bearing: cinematicBearing(located.map(item => item.coordinates)),
            maxPitch: 85,
            attributionControl: false,
            canvasContextAttributes: { antialias: true },
          });
          mapRef.current = map;
          setMapInstance(map);
          map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
          resizeObserver = new ResizeObserver(() => {
            map.resize();
          });
          resizeObserver.observe(container.current);
          const finishLoad = () => {
            if (disposed) return;
            map.resize();
            syncPlanMapRoute(map, locatedRef.current.map(item => item.coordinates));
            const dash = [
              [0.01, 4.2, 1.6, 0.01],
              [0.4, 4.2, 1.2, 0.4],
              [0.9, 4.2, 0.8, 0.8],
              [1.4, 4.2, 0.4, 1.2],
              [1.8, 4.2, 0.01, 1.6],
              [2.3, 4.2, 0.01, 2],
            ];
            let step = 0;
            let last = 0;
            const tick = (now: number) => {
              if (disposed) return;
              if (now - last > 70) {
                last = now;
                step = (step + 1) % dash.length;
                if (map.getLayer("plan-route-flow")) {
                  map.setPaintProperty("plan-route-flow", "line-dasharray", dash[step]);
                }
              }
              flowFrame = requestAnimationFrame(tick);
            };
            flowFrame = requestAnimationFrame(tick);
            setReady(true);
          };
          map.once("load", finishLoad);
          map.once("style.load", () => {
            syncPlanMapRoute(map, locatedRef.current.map(item => item.coordinates));
          });
        } catch {
          if (!disposed) setError(true);
        }
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(flowFrame);
      resizeObserver?.disconnect();
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, [routeKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !mapRef.current) return;
      if (roadPath) syncPlanMapRoadRoute(map, roadPath);
      else syncPlanMapRoute(map, located.map(item => item.coordinates));
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = located.map((item, index) => {
        const element = document.createElement("button");
        element.className = "plan-map-marker";
        element.type = "button";
        element.innerHTML = `<span><i>${index + 1}</i></span><b>${escapeHtml(item.placeName)}</b>`;
        element.setAttribute("aria-label", `${index + 1}. ${item.placeName}`);
        return new maplibregl.Marker({ element, ...htmlMarkerPlacement }).setLngLat(item.coordinates).addTo(map);
      });
      const bearing = cinematicBearing(located.map(item => item.coordinates));
      const frame = (center: [number, number], zoom: number) => {
        map.easeTo({ center, zoom, pitch: MAP_PITCH, bearing, duration: 850 });
      };
      if (located.length === 1) frame(located[0].coordinates, 14.2);
      else {
        const compact = map.getContainer().clientWidth < 420;
        const bounds = located.slice(1).reduce((next, item) => next.extend(item.coordinates), new maplibregl.LngLatBounds(located[0].coordinates, located[0].coordinates));
        const fitted = map.cameraForBounds(bounds, {
          padding: compact ? { top: 48, bottom: 42, left: 36, right: 36 } : { top: 88, bottom: 96, left: 72, right: 88 },
          maxZoom: 13.3,
          bearing,
        });
        if (fitted?.center && typeof fitted.zoom === "number") {
          const center = maplibregl.LngLat.convert(fitted.center);
          frame([center.lng, center.lat], fitted.zoom);
        } else {
          frame(located[0].coordinates, 13);
        }
      }
    });
    return () => { disposed = true; };
  }, [located, ready, routeKey, roadPath]);

  if (!located.length) return <section className="planner-map map-unavailable"><div><b>표시할 좌표가 없어요</b><span>장소를 담으면 실제 지도와 동선이 보여요.</span></div></section>;

  return <section className={`planner-map${expanded ? " is-expanded" : ""}`} aria-label={`${dayLabel ?? "여행"} 지도`}>
    <div ref={container} className="maplibre-canvas" />
    <MapRouteOverlay
      map={mapInstance}
      anchors={located.map(item => ({ coordinates: item.coordinates }))}
      pinVariant="planner"
      active={ready && located.length >= 2}
    />
    {!ready && !error && <div className="map-loading"><span>여행 지도를 펼치고 있어요.</span><i /></div>}
    {error && <div className="map-error"><b>지도를 불러오지 못했어요</b><span>장소와 일정은 그대로 저장되어 있어요.</span></div>}
    <div className="map-summary"><span>{dayLabel ?? "DAY 1"}</span><b>{located.length}곳</b><small>번호 순서대로 동선이 이어져요</small></div>
  </section>;
}
