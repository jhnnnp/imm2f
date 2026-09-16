"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { PlanItem } from "@/features/planning/types/plan";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function PlanMap({ items, dayLabel }: { items: PlanItem[]; dayLabel?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const located = items.filter((item): item is PlanItem & { coordinates: [number, number] } => Boolean(item.coordinates));

  useEffect(() => {
    if (!container.current || mapRef.current || !located.length) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({ container: container.current, style: MAP_STYLE, center: located[0].coordinates, zoom: 13, pitch: 28, attributionControl: false });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
      map.once("load", () => { if (!disposed) setReady(true); });
      map.on("error", event => { if (!event.error?.message.includes("404")) setError(true); });
      mapRef.current = map;
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
