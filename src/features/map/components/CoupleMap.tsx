"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import { getDemoPlaces, subscribeDemoPlaces } from "@/features/places/demoPlaces";
import type { Memory } from "@/features/memories/types";
import type { Place, PlacePreferenceStatus } from "@/features/places/types/place";

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "openstreetmap": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#e7ece8" } },
    { id: "openstreetmap", type: "raster", source: "openstreetmap", paint: { "raster-opacity": 0.92, "raster-saturation": -0.32, "raster-contrast": -0.04, "raster-brightness-max": 0.96 } },
  ],
};
const DEFAULT_CENTER: [number, number] = [126.978, 37.5665];

type PinLabel = "want" | "visited" | "revisit" | "not_interested" | "memory";
type PlacePin = { kind: "place"; id: string; label: Exclude<PinLabel, "memory">; place: Place; coordinates: [number, number] };
type MemoryPin = { kind: "memory"; id: string; label: "memory"; memory: Memory; coordinates: [number, number] };
type MapPin = PlacePin | MemoryPin;
type MapState = "loading" | "ready" | "error";

const FILTERS: ReadonlyArray<{ id: PinLabel; label: string }> = [
  { id: "want", label: "가고 싶은 곳" },
  { id: "visited", label: "다녀온 곳" },
  { id: "revisit", label: "또 가고 싶은 곳" },
  { id: "not_interested", label: "관심 없는 곳" },
  { id: "memory", label: "특별한 추억" },
];

function normalizedPlaceLabel(status: PlacePreferenceStatus): Exclude<PinLabel, "memory"> | null {
  if (status === "want" || status === "must_visit") return "want";
  if (status === "visited") return "visited";
  if (status === "revisit") return "revisit";
  if (status === "not_interested" || status === "dislike") return "not_interested";
  return null;
}

export function CoupleMap({ places: initialPlaces, memories, persist }: { places: Place[]; memories: Memory[]; persist: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [places, setPlaces] = useState(initialPlaces);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [activeLabels, setActiveLabels] = useState<Set<PinLabel>>(() => new Set(FILTERS.map(item => item.id)));

  useEffect(() => {
    if (persist) {
      setPlaces(initialPlaces);
      return;
    }
    const sync = () => setPlaces(getDemoPlaces());
    sync();
    return subscribeDemoPlaces(sync);
  }, [initialPlaces, persist]);

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    places.forEach(place => {
      if (!place.coordinates) return;
      const label = normalizedPlaceLabel(place.userStatus);
      if (!label) return;
      next.push({ kind: "place", id: `place:${place.id}`, label, place, coordinates: place.coordinates });
    });
    memories.forEach(memory => {
      if (memory.coordinates) next.push({ kind: "memory", id: `memory:${memory.id}`, label: "memory", memory, coordinates: memory.coordinates });
    });
    return next;
  }, [places, memories]);

  const visiblePins = useMemo(() => pins.filter(pin => activeLabels.has(pin.label)), [pins, activeLabels]);

  const counts = useMemo(() => FILTERS.reduce<Record<PinLabel, number>>((result, filter) => {
    result[filter.id] = pins.filter(pin => pin.label === filter.id).length;
    return result;
  }, { want: 0, visited: 0, revisit: 0, not_interested: 0, memory: 0 }), [pins]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    setMapState("loading");

    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: DEFAULT_CENTER,
        zoom: 10.2,
        pitch: 18,
        attributionControl: { compact: true },
        maxPitch: 55,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");

      map.once("load", () => {
        if (disposed) return;
        map.on("click", () => setSelected(null));
        resizeObserver = new ResizeObserver(() => map.resize());
        if (container.current) resizeObserver.observe(container.current);
        setMapState("ready");
      });
    }).catch(() => { if (!disposed) setMapState("error"); });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    if (!visiblePins.length) {
      map.easeTo({ center: DEFAULT_CENTER, zoom: 10.2, pitch: 18, duration: 500 });
      return;
    }
    void import("maplibre-gl").then(maplibregl => {
      markersRef.current = visiblePins.map(pin => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `our-map-marker is-${pin.label}`;
        element.setAttribute("aria-label", pin.kind === "place" ? pin.place.name : pin.memory.title);
        element.innerHTML = `<span>${pin.label === "visited" ? "✓" : pin.label === "revisit" ? "↻" : pin.label === "not_interested" ? "×" : pin.label === "memory" ? "✦" : "♥"}</span>`;
        element.addEventListener("click", event => {
          event.stopPropagation();
          setSelected(pin);
          map.easeTo({ center: pin.coordinates, zoom: Math.max(map.getZoom(), 13.5), duration: 650, offset: [-110, 0] });
        });
        return new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(pin.coordinates).addTo(map);
      });
      if (visiblePins.length === 1) map.easeTo({ center: visiblePins[0].coordinates, zoom: 13.2, duration: 600 });
      else {
        const bounds = visiblePins.slice(1).reduce((next, pin) => next.extend(pin.coordinates), new maplibregl.LngLatBounds(visiblePins[0].coordinates, visiblePins[0].coordinates));
        map.fitBounds(bounds, { padding: { top: 100, right: 90, bottom: 90, left: 360 }, maxZoom: 12.5, duration: 750 });
      }
    });
  }, [visiblePins, mapState]);

  function toggleFilter(label: PinLabel) {
    setActiveLabels(current => {
      const next = new Set(current);
      if (next.has(label) && next.size > 1) next.delete(label);
      else next.add(label);
      return next;
    });
    setSelected(null);
  }

  return <div className="couple-map-wrap">
    <div ref={container} className="maplibre-canvas" aria-label="둘의 장소 지도" />
    {mapState === "loading" && <div className="map-loading" role="status"><span>둘의 지도를 펼치고 있어요</span><i /></div>}
    {mapState === "error" && <div className="map-error" role="alert"><b>지도를 불러오지 못했어요</b><span>잠시 후 다시 시도해 주세요.</span><button type="button" className="outline-button" onClick={() => setMapAttempt(value => value + 1)}>다시 불러오기</button></div>}

    <section className="map-command-card" aria-label="지도 필터">
      <header><div><span className="eyebrow">OUR MAP</span><h1>우리의 장소</h1></div><b>{pins.length}<small>PINS</small></b></header>
      <p>둘이 저장한 장소와 추억을 한눈에 모아봐요.</p>
      <div className="map-filter-list">
        {FILTERS.map(filter => <button type="button" key={filter.id} className={`map-filter is-${filter.id} ${activeLabels.has(filter.id) ? "is-active" : ""}`} aria-pressed={activeLabels.has(filter.id)} onClick={() => toggleFilter(filter.id)}><i /><span>{filter.label}</span><b>{counts[filter.id]}</b></button>)}
      </div>
      {activeLabels.size < FILTERS.length && <button type="button" className="map-show-all" onClick={() => { setActiveLabels(new Set(FILTERS.map(item => item.id))); setSelected(null); }}>모두 보기</button>}
      {!pins.length && <div className="map-empty-hint"><b>아직 지도에 표시할 장소가 없어요</b><span>Places에서 마음을 표시하면 여기에 바로 나타나요.</span><Link href="/places">장소 둘러보기 →</Link></div>}
    </section>

    {selected && <aside className="map-place-card">
      <button type="button" onClick={() => setSelected(null)} aria-label="선택한 장소 닫기">×</button>
      {selected.kind === "place" && selected.place.image && <img src={selected.place.image} alt="" />}
      {selected.kind === "memory" && selected.memory.coverUrl && <img src={selected.memory.coverUrl} alt="" />}
      <span>{selected.kind === "place" ? `${selected.place.categoryLabel} · ${selected.place.district}` : `추억 · ${selected.memory.locationLabel || selected.memory.happenedOn}`}</span>
      <h2>{selected.kind === "place" ? selected.place.name : selected.memory.title}</h2>
      <p>{selected.kind === "place" ? selected.place.description || "둘의 장소로 저장했어요." : selected.memory.description || "둘만 아는 장면이에요."}</p>
      <Link href={selected.kind === "place" ? `/places?selected=${selected.place.id}` : "/memories"}>{selected.kind === "place" ? "장소 자세히 보기" : "추억 보러 가기"} →</Link>
    </aside>}
    {mapState === "ready" && visiblePins.length === 0 && pins.length > 0 && <div className="map-filter-empty">선택한 필터에 표시할 장소가 없어요.</div>}
    <div className="map-poem" aria-hidden="true">more places,<br />more stories,<br />only us.</div>
  </div>;
}
