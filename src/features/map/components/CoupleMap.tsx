"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { PLACES } from "@/features/places/data/places";
import type { Place } from "@/features/places/types/place";

export function CoupleMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [selected, setSelected] = useState<Place | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: { version: 8, sources: {}, layers: [{ id: "paper", type: "background", paint: { "background-color": "#dce7e3" } }] },
        center: [126.708, 35.982],
        zoom: 12.3,
        pitch: 38,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
      map.on("load", () => {
        map.addSource("memory-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: PLACES.slice(0, 4).map(place => place.coordinates) } } });
        map.addLayer({ id: "memory-route", type: "line", source: "memory-route", paint: { "line-color": "#637f73", "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
        setMapReady(true);
        PLACES.forEach(place => {
          const marker = document.createElement("button");
          marker.className = "memory-marker";
          marker.type = "button";
          marker.ariaLabel = `${place.name} 상세 보기`;
          marker.innerHTML = `<span>♥</span>`;
          marker.addEventListener("click", () => { setSelected(place); map.flyTo({ center: place.coordinates, zoom: 14.5, pitch: 50, duration: 900 }); });
          new maplibregl.Marker({ element: marker, anchor: "bottom" }).setLngLat(place.coordinates).addTo(map);
        });
      });
      mapRef.current = map;
    });
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  return <div className="couple-map-wrap"><div ref={container} className="maplibre-canvas" />{!mapReady && <div className="map-loading"><span>둘의 지도를 펼치고 있어요.</span><i /></div>}<div className="map-overlay-title"><span className="eyebrow">OUR MAP · 46 MEMORIES</span><h1>둘만의 장소가<br />지도 위에 쌓이고 있어요.</h1><div className="map-legend"><span><i className="visited-dot" />가본 곳 28</span><span><i className="want-dot" />가고 싶은 곳 14</span><span><i className="memory-dot" />특별한 추억 4</span></div></div>{selected && <aside className="map-place-card"><button onClick={() => setSelected(null)}>×</button>{selected.image && <img src={selected.image} alt={selected.name} />}<span>{selected.categoryLabel} · {selected.district}</span><h2>{selected.name}</h2><p>{selected.description}</p></aside>}<div className="map-poem">more places,<br />more stories,<br />only us.</div></div>;
}
