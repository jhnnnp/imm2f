"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PlanItem } from "@/features/planning/types/plan";
import { htmlMarkerPlacement } from "@/features/map/htmlMarker";
import { buildPlanRoute, cinematicBearing } from "../planRoute";

const MAP_PITCH = 60;
const EMPTY_ROUTE = () => ({ type: "FeatureCollection" as const, features: [] });

const MAP_STYLE: StyleSpecification = {
  version: 8,
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
      id: "plan-route-shadow",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#143528",
        "line-opacity": 0.32,
        "line-blur": 6,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 12, 14, 20, 16, 26],
        "line-translate": [0, 14],
        "line-translate-anchor": "viewport",
      },
    },
    {
      id: "plan-route-bloom",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#4dffb0",
        "line-blur": 16,
        "line-opacity": 0.78,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 18, 14, 32, 16, 44],
      },
    },
    {
      id: "plan-route-floor",
      type: "fill",
      source: "plan-route-body",
      paint: {
        "fill-color": "#2fd18a",
        "fill-opacity": 0.72,
      },
    },
    {
      id: "plan-route-aura",
      type: "fill-extrusion",
      source: "plan-route-aura",
      paint: {
        "fill-extrusion-color": "#7af0c0",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["coalesce", ["get", "base"], 0],
        "fill-extrusion-opacity": 0.32,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: "plan-route-body",
      type: "fill-extrusion",
      source: "plan-route-body",
      paint: {
        "fill-extrusion-color": "#2fd18a",
        "fill-extrusion-height": 980,
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.9,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: "plan-route-core",
      type: "fill-extrusion",
      source: "plan-route-core",
      paint: {
        "fill-extrusion-color": "#f3fff8",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["coalesce", ["get", "base"], 0],
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": false,
      },
    },
    {
      id: "plan-route-stops",
      type: "fill-extrusion",
      source: "plan-route-stops",
      paint: {
        "fill-extrusion-color": "#d9ffe9",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["coalesce", ["get", "base"], 0],
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      id: "plan-nodes-glow",
      type: "circle",
      source: "plan-route-nodes",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 14, 22, 16, 28],
        "circle-color": "#7af0c0",
        "circle-opacity": 0.28,
        "circle-blur": 0.85,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "plan-nodes-core",
      type: "circle",
      source: "plan-route-nodes",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 14, 6.5, 16, 8],
        "circle-color": "#f7fffb",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#3ecf8e",
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "plan-route-halo",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#e8fff3",
        "line-blur": 0.4,
        "line-opacity": 0.95,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5.5, 14, 8, 16, 11],
      },
    },
    {
      id: "plan-route-edge",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#f7fffb",
        "line-opacity": 1,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.8, 14, 2.6, 16, 3.2],
      },
    },
    {
      id: "plan-route-flow",
      type: "line",
      source: "plan-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.1, 14, 1.6, 16, 2],
        "line-dasharray": [1.4, 3.8],
      },
    },
  ],
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function hasValidCoordinates(item: PlanItem): item is PlanItem & { coordinates: [number, number] } {
  const coordinates = item.coordinates;
  return Boolean(
    coordinates
      && Number.isFinite(coordinates[0])
      && Number.isFinite(coordinates[1])
      && Math.abs(coordinates[0]) <= 180
      && Math.abs(coordinates[1]) <= 90,
  );
}

export function PlanMap({ items, dayLabel, expanded = false }: { items: PlanItem[]; dayLabel?: string; expanded?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const located = items.filter(hasValidCoordinates);

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
          map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
          resizeObserver = new ResizeObserver(() => {
            map.resize();
          });
          resizeObserver.observe(container.current);
          map.once("style.load", () => {
            map.resize();
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
            if (!disposed) setReady(true);
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
    };
  }, [located.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !mapRef.current) return;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = located.map((item, index) => {
        const element = document.createElement("button");
        element.className = "plan-map-marker";
        element.type = "button";
        element.innerHTML = `<span><i>${index + 1}</i></span><b>${escapeHtml(item.placeName)}</b>`;
        element.setAttribute("aria-label", `${index + 1}. ${item.placeName}`);
        return new maplibregl.Marker({ element, ...htmlMarkerPlacement }).setLngLat(item.coordinates).addTo(map);
      });
      const route = buildPlanRoute(located.map(item => item.coordinates));
      (map.getSource("plan-route") as GeoJSONSource | undefined)?.setData(route.line);
      (map.getSource("plan-route-aura") as GeoJSONSource | undefined)?.setData(route.aura);
      (map.getSource("plan-route-body") as GeoJSONSource | undefined)?.setData(route.body);
      (map.getSource("plan-route-core") as GeoJSONSource | undefined)?.setData(route.core);
      (map.getSource("plan-route-stops") as GeoJSONSource | undefined)?.setData(route.stops);
      (map.getSource("plan-route-nodes") as GeoJSONSource | undefined)?.setData(route.nodes);
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
  }, [items, ready]);

  if (!located.length) return <section className="planner-map map-unavailable"><div><b>표시할 좌표가 없어요</b><span>장소를 담으면 실제 지도와 동선이 보여요.</span></div></section>;

  return <section className={`planner-map${expanded ? " is-expanded" : ""}`} aria-label={`${dayLabel ?? "여행"} 지도`}>
    <div ref={container} className="maplibre-canvas" />
    {!ready && !error && <div className="map-loading"><span>여행 지도를 펼치고 있어요.</span><i /></div>}
    {error && <div className="map-error"><b>지도를 불러오지 못했어요</b><span>장소와 일정은 그대로 저장되어 있어요.</span></div>}
    <div className="map-summary"><span>{dayLabel ?? "DAY 1"}</span><b>{located.length}곳</b><small>저장한 순서대로 이어요</small></div>
  </section>;
}
