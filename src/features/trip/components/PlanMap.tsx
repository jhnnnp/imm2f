"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import type { PlanItem } from "@/features/planning/types/plan";

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#e8e9e2" } },
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-opacity": 0.78,
        "raster-saturation": -0.42,
        "raster-contrast": -0.1,
        "raster-brightness-min": 0.12,
        "raster-brightness-max": 0.96,
      },
    },
  ],
};

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

export function PlanMap({ items, dayLabel }: { items: PlanItem[]; dayLabel?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const located = items.filter(hasValidCoordinates);

  useEffect(() => {
    if (!container.current || mapRef.current || !located.length) return;
    let disposed = false;
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
            pitch: 28,
            attributionControl: false,
          });
          mapRef.current = map;
          map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
          map.once("load", () => {
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
        element.innerHTML = `<span><i>${index + 1}</i></span><b>${item.placeName}</b>`;
        element.setAttribute("aria-label", `${index + 1}. ${item.placeName}`);
        return new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(item.coordinates).addTo(map);
      });
      const data = { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: located.map(item => item.coordinates) } };
      const source = map.getSource("plan-route") as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else if (located.length >= 2) {
        map.addSource("plan-route", { type: "geojson", data });
        map.addLayer({ id: "plan-route", type: "line", source: "plan-route", paint: { "line-color": "#637f73", "line-width": 4, "line-opacity": 0.78, "line-dasharray": [1.4, 1.5] } });
      }
      if (located.length === 1) map.easeTo({ center: located[0].coordinates, zoom: 14, duration: 600 });
      else {
        const bounds = located.slice(1).reduce((next, item) => next.extend(item.coordinates), new maplibregl.LngLatBounds(located[0].coordinates, located[0].coordinates));
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 700 });
      }
    });
    return () => { disposed = true; };
  }, [items, ready]);

  if (!located.length) return <section className="planner-map map-unavailable"><div><b>표시할 좌표가 없어요</b><span>장소를 담으면 실제 지도와 동선이 보여요.</span></div></section>;

  return <section className="planner-map" aria-label={`${dayLabel ?? "여행"} 지도`}>
    <div ref={container} className="maplibre-canvas" />
    {!ready && !error && <div className="map-loading"><span>여행 지도를 펼치고 있어요.</span><i /></div>}
    {error && <div className="map-error"><b>지도를 불러오지 못했어요</b><span>장소와 일정은 그대로 저장되어 있어요.</span></div>}
    <div className="map-summary"><span>{dayLabel ?? "DAY 1"}</span><b>{located.length}곳</b><small>저장한 순서대로 이어요</small></div>
  </section>;
}
