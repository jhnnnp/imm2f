"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import type { Memory } from "@/features/memories/types";
import type { Place } from "@/features/places/types/place";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER: [number, number] = [126.978, 37.5665];

type MapPin =
  | { kind: "place"; id: string; label: "visited" | "want"; place: Place; coordinates: [number, number] }
  | { kind: "memory"; id: string; label: "memory"; memory: Memory; coordinates: [number, number] };

function placeLabel(place: Place): "visited" | "want" {
  return place.userStatus === "visited" || place.userStatus === "revisit" ? "visited" : "want";
}

export function CoupleMap({ places, memories }: { places: Place[]; memories: Memory[] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pinsRef = useRef<Map<string, MapPin>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [selected, setSelected] = useState<MapPin | null>(null);

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    places.forEach(place => {
      if (!place.coordinates || !["visited", "revisit", "want", "must_visit"].includes(place.userStatus)) return;
      next.push({ kind: "place", id: `place:${place.id}`, label: placeLabel(place), place, coordinates: place.coordinates });
    });
    memories.forEach(memory => {
      if (memory.coordinates) next.push({ kind: "memory", id: `memory:${memory.id}`, label: "memory", memory, coordinates: memory.coordinates });
    });
    return next;
  }, [places, memories]);

  pinsRef.current = new Map(pins.map(pin => [pin.id, pin]));
  const counts = useMemo(() => ({
    visited: pins.filter(pin => pin.label === "visited").length,
    want: pins.filter(pin => pin.label === "want").length,
    memory: pins.filter(pin => pin.label === "memory").length,
  }), [pins]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({ container: container.current, style: MAP_STYLE, center: DEFAULT_CENTER, zoom: 6.5, pitch: 22, attributionControl: false });
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
      map.on("error", event => { if (!event.error?.message.includes("404")) setMapError(true); });
      map.once("load", () => {
        if (disposed) return;
        map.addSource("our-pins", {
          type: "geojson",
          cluster: true,
          clusterMaxZoom: 11,
          clusterRadius: 48,
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({ id: "pin-clusters", type: "circle", source: "our-pins", filter: ["has", "point_count"], paint: { "circle-color": "#8199a3", "circle-radius": ["step", ["get", "point_count"], 22, 10, 28, 30, 35], "circle-stroke-width": 4, "circle-stroke-color": "#fbf9f4", "circle-opacity": 0.92 } });
        map.addLayer({ id: "pin-cluster-count", type: "symbol", source: "our-pins", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#ffffff" } });
        map.addLayer({ id: "pin-halo", type: "circle", source: "our-pins", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 13, "circle-color": "#fbf9f4", "circle-opacity": 0.9 } });
        map.addLayer({ id: "pin-points", type: "circle", source: "our-pins", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 8, "circle-color": ["match", ["get", "label"], "visited", "#8fa697", "memory", "#a9886d", "#8199a3"], "circle-stroke-width": 2, "circle-stroke-color": "#fbf9f4" } });

        map.on("click", "pin-clusters", async event => {
          const feature = event.features?.[0];
          const clusterId = Number(feature?.properties?.cluster_id);
          const source = map.getSource("our-pins") as GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const coordinates = (feature?.geometry as GeoJSON.Point).coordinates as [number, number];
          map.easeTo({ center: coordinates, zoom, duration: 650 });
        });
        map.on("click", "pin-points", (event: MapLayerMouseEvent) => {
          const id = String(event.features?.[0]?.properties?.id ?? "");
          const pin = pinsRef.current.get(id);
          if (!pin) return;
          setSelected(pin);
          map.easeTo({ center: pin.coordinates, zoom: Math.max(map.getZoom(), 14), duration: 650 });
        });
        ["pin-clusters", "pin-points"].forEach(layer => {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        });
        setMapReady(true);
      });
      mapRef.current = map;
    });
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("our-pins") as GeoJSONSource;
    source.setData({
      type: "FeatureCollection",
      features: pins.map(pin => ({ type: "Feature", properties: { id: pin.id, label: pin.label }, geometry: { type: "Point", coordinates: pin.coordinates } })),
    });
    if (!pins.length) return;
    void import("maplibre-gl").then(maplibregl => {
      if (pins.length === 1) map.easeTo({ center: pins[0].coordinates, zoom: 13, duration: 600 });
      else {
        const bounds = pins.slice(1).reduce((next, pin) => next.extend(pin.coordinates), new maplibregl.LngLatBounds(pins[0].coordinates, pins[0].coordinates));
        map.fitBounds(bounds, { padding: 100, maxZoom: 12, duration: 750 });
      }
    });
  }, [pins, mapReady]);

  return <div className="couple-map-wrap">
    <div ref={container} className="maplibre-canvas" />
    {!mapReady && !mapError && pins.length > 0 && <div className="map-loading"><span>둘의 지도를 펼치고 있어요.</span><i /></div>}
    {mapError && <div className="map-error"><b>지도를 불러오지 못했어요</b><span>네트워크를 확인한 뒤 다시 열어 주세요.</span></div>}
    <div className="map-overlay-title"><span className="eyebrow">OUR MAP · {pins.length} PINS</span><h1>둘만의 장소가<br />지도 위에 쌓이고 있어요.</h1><div className="map-legend"><span><i className="visited-dot" />가본 곳 {counts.visited}</span><span><i className="want-dot" />가고 싶은 곳 {counts.want}</span><span><i className="memory-dot" />특별한 추억 {counts.memory}</span></div>{!pins.length && <p className="form-hint map-empty-hint">저장한 장소나 좌표가 있는 추억이 생기면 핀이 올라와요.</p>}</div>
    {selected && <aside className="map-place-card"><button type="button" onClick={() => setSelected(null)} aria-label="닫기">×</button>{selected.kind === "place" && selected.place.image && <img src={selected.place.image} alt={selected.place.name} />}{selected.kind === "memory" && selected.memory.coverUrl && <img src={selected.memory.coverUrl} alt={selected.memory.title} />}<span>{selected.kind === "place" ? `${selected.place.categoryLabel} · ${selected.place.district}` : `추억 · ${selected.memory.locationLabel || selected.memory.happenedOn}`}</span><h2>{selected.kind === "place" ? selected.place.name : selected.memory.title}</h2><p>{selected.kind === "place" ? selected.place.description || "둘의 장소." : selected.memory.description || "둘만 아는 장면."}</p></aside>}
    <div className="map-poem">more places,<br />more stories,<br />only us.</div>
  </div>;
}
