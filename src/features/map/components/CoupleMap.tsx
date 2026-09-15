"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { Memory } from "@/features/memories/types";
import type { Place } from "@/features/places/types/place";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DEFAULT_CENTER: [number, number] = [126.978, 37.5665];

type MapPin =
  | { kind: "place"; id: string; label: "visited" | "want" | "memory"; place: Place }
  | { kind: "memory"; id: string; label: "memory"; memory: Memory; coordinates: [number, number] };

function placeLabel(place: Place): "visited" | "want" | "memory" {
  if (place.userStatus === "visited" || place.userStatus === "revisit") return "visited";
  if (place.userStatus === "want" || place.userStatus === "must_visit") return "want";
  return "want";
}

export function CoupleMap({
  places,
  memories,
}: {
  places: Place[];
  memories: Memory[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<MapPin | null>(null);

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    places.forEach(place => {
      if (!Number.isFinite(place.coordinates[0]) || !Number.isFinite(place.coordinates[1])) return;
      if (!["visited", "revisit", "want", "must_visit"].includes(place.userStatus)) return;
      next.push({ kind: "place", id: `place:${place.id}`, label: placeLabel(place), place });
    });
    memories.forEach(memory => {
      if (!memory.coordinates) return;
      next.push({ kind: "memory", id: `memory:${memory.id}`, label: "memory", memory, coordinates: memory.coordinates });
    });
    return next;
  }, [places, memories]);

  const counts = useMemo(() => ({
    visited: pins.filter(pin => pin.label === "visited").length,
    want: pins.filter(pin => pin.label === "want").length,
    memory: pins.filter(pin => pin.label === "memory").length,
  }), [pins]);

  const center = useMemo<[number, number]>(() => {
    if (pins[0]?.kind === "place") return pins[0].place.coordinates;
    if (pins[0]?.kind === "memory") return pins[0].coordinates;
    return DEFAULT_CENTER;
  }, [pins]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: DEFAULT_CENTER,
        zoom: 11.5,
        pitch: 28,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
      map.once("style.load", () => {
        if (disposed) return;
        setMapReady(true);
      });
      mapRef.current = map;
    });
    return () => {
      disposed = true;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !pins.length) return;
    map.flyTo({ center, zoom: 11.8, duration: 700 });
  }, [center, mapReady, pins.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !mapRef.current) return;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];

      const route = pins
        .map(pin => pin.kind === "place" ? pin.place.coordinates : pin.coordinates)
        .filter((coords): coords is [number, number] => Boolean(coords));

      if (map.getLayer("memory-route")) map.removeLayer("memory-route");
      if (map.getSource("memory-route")) map.removeSource("memory-route");
      if (route.length >= 2) {
        map.addSource("memory-route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.slice(0, 8) } },
        });
        map.addLayer({
          id: "memory-route",
          type: "line",
          source: "memory-route",
          paint: { "line-color": "#637f73", "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.7 },
        });
      }

      pins.forEach(pin => {
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = `memory-marker is-${pin.label}`;
        const coordinates = pin.kind === "place" ? pin.place.coordinates : pin.coordinates;
        const name = pin.kind === "place" ? pin.place.name : pin.memory.title;
        marker.setAttribute("aria-label", `${name} 보기`);
        marker.innerHTML = `<span>${pin.label === "memory" ? "♥" : pin.label === "visited" ? "·" : "○"}</span>`;
        marker.addEventListener("click", () => {
          setSelected(pin);
          map.flyTo({ center: coordinates, zoom: 14.2, pitch: 42, duration: 800 });
        });
        markersRef.current.push(new maplibregl.Marker({ element: marker, anchor: "bottom" }).setLngLat(coordinates).addTo(map));
      });
    });
    return () => {
      disposed = true;
    };
  }, [pins, mapReady]);

  return (
    <div className="couple-map-wrap">
      <div ref={container} className="maplibre-canvas" />
      {!mapReady && <div className="map-loading"><span>둘의 지도를 펼치고 있어요.</span><i /></div>}
      <div className="map-overlay-title">
        <span className="eyebrow">OUR MAP · {pins.length} PINS</span>
        <h1>둘만의 장소가<br />지도 위에 쌓이고 있어요.</h1>
        <div className="map-legend">
          <span><i className="visited-dot" />가본 곳 {counts.visited}</span>
          <span><i className="want-dot" />가고 싶은 곳 {counts.want}</span>
          <span><i className="memory-dot" />특별한 추억 {counts.memory}</span>
        </div>
        {!pins.length && (
          <p className="form-hint map-empty-hint">저장한 장소나 좌표가 있는 추억이 생기면 핀이 올라와요.</p>
        )}
      </div>
      {selected?.kind === "place" && (
        <aside className="map-place-card">
          <button type="button" onClick={() => setSelected(null)} aria-label="닫기">×</button>
          {selected.place.image && <img src={selected.place.image} alt={selected.place.name} />}
          <span>{selected.place.categoryLabel} · {selected.place.district}</span>
          <h2>{selected.place.name}</h2>
          <p>{selected.place.description}</p>
        </aside>
      )}
      {selected?.kind === "memory" && (
        <aside className="map-place-card">
          <button type="button" onClick={() => setSelected(null)} aria-label="닫기">×</button>
          {selected.memory.coverUrl && <img src={selected.memory.coverUrl} alt={selected.memory.title} />}
          <span>추억 · {selected.memory.locationLabel || selected.memory.happenedOn}</span>
          <h2>{selected.memory.title}</h2>
          <p>{selected.memory.description || "둘만 아는 장면."}</p>
        </aside>
      )}
      <div className="map-poem">more places,<br />more stories,<br />only us.</div>
    </div>
  );
}
