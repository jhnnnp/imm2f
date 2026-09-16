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
    basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "&copy; OpenStreetMap contributors" },
    memorymap: { type: "vector", tiles: ["/api/map-tiles/{z}/{x}/{y}"], minzoom: 0, maxzoom: 14, attribution: "&copy; OpenStreetMap contributors" },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#e8e6dc" } },
    { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.74, "raster-saturation": -0.55, "raster-contrast": -0.12, "raster-brightness-min": 0.16, "raster-brightness-max": 0.96 } },
    { id: "parks", type: "fill", source: "memorymap", "source-layer": "land", filter: ["in", ["get", "kind"], ["literal", ["park", "forest", "grass", "garden", "recreation_ground"]]], paint: { "fill-color": "#aec2aa", "fill-opacity": 0.62 } },
    { id: "water", type: "fill", source: "memorymap", "source-layer": "water_polygons", paint: { "fill-color": "#aebfc0", "fill-opacity": 0.9 } },
    { id: "roads-casing", type: "line", source: "memorymap", "source-layer": "streets", filter: ["!=", ["get", "tunnel"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#cfcbc0", "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 11, 1.2, 15, 6, 18, 17], "line-opacity": 0.86 } },
    { id: "roads", type: "line", source: "memorymap", "source-layer": "streets", filter: ["!=", ["get", "tunnel"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["match", ["get", "kind"], ["motorway", "trunk", "primary"], "#d8c3a2", "#f5f1e8"], "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 11, 0.7, 15, 3.8, 18, 12], "line-opacity": 0.96 } },
    { id: "building-footprints", type: "fill", source: "memorymap", "source-layer": "buildings", minzoom: 12, paint: { "fill-color": "#d5d2c8", "fill-outline-color": "#c5c2b9", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.2, 15, 0.76] } },
    { id: "buildings-3d", type: "fill-extrusion", source: "memorymap", "source-layer": "buildings", minzoom: 13.2, paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 12], 0, "#d9d8d0", 30, "#c7cec7", 100, "#aebdb4"], "fill-extrusion-height": ["coalesce", ["get", "height"], ["*", ["get", "levels"], 3.2], 12], "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0], "fill-extrusion-opacity": 0.84, "fill-extrusion-vertical-gradient": true } },
  ],
};

const DEFAULT_CENTER: [number, number] = [126.978, 37.5665];
type PinLabel = "want" | "visited" | "revisit" | "memory";
type PlacePin = { kind: "place"; id: string; label: Exclude<PinLabel, "memory">; place: Place; coordinates: [number, number] };
type MemoryPin = { kind: "memory"; id: string; label: "memory"; memory: Memory; coordinates: [number, number] };
type MapPin = PlacePin | MemoryPin;
type MapMode = "places" | "memories" | "time";
type ViewMode = "2d" | "3d";
type MapState = "loading" | "ready" | "error";

const FILTERS: ReadonlyArray<{ id: PinLabel; label: string }> = [
  { id: "want", label: "가고 싶은 곳" },
  { id: "visited", label: "다녀온 곳" },
  { id: "revisit", label: "다시 가고 싶은 곳" },
  { id: "memory", label: "추억" },
];

function normalizedPlaceLabel(status: PlacePreferenceStatus): Exclude<PinLabel, "memory"> | null {
  if (status === "want" || status === "must_visit") return "want";
  if (status === "visited") return "visited";
  if (status === "revisit") return "revisit";
  return null;
}

function pinName(pin: MapPin) { return pin.kind === "place" ? pin.place.name : pin.memory.title; }
export function CoupleMap({ places: initialPlaces, memories, persist }: { places: Place[]; memories: Memory[]; persist: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [places, setPlaces] = useState(initialPlaces);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [mode, setMode] = useState<MapMode>("places");
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [activeLabels, setActiveLabels] = useState<Set<PinLabel>>(() => new Set(FILTERS.map(item => item.id)));

  useEffect(() => {
    if (persist) { setPlaces(initialPlaces); return; }
    const sync = () => setPlaces(getDemoPlaces());
    sync();
    return subscribeDemoPlaces(sync);
  }, [initialPlaces, persist]);

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    places.forEach(place => {
      if (!place.coordinates) return;
      const label = normalizedPlaceLabel(place.userStatus);
      if (label) next.push({ kind: "place", id: `place:${place.id}`, label, place, coordinates: place.coordinates });
    });
    memories.forEach(memory => {
      if (memory.coordinates) next.push({ kind: "memory", id: `memory:${memory.id}`, label: "memory", memory, coordinates: memory.coordinates });
    });
    return next;
  }, [places, memories]);

  const years = useMemo(() => {
    const memoryYears = memories.map(memory => Number(memory.happenedOn.slice(0, 4))).filter(Number.isFinite);
    const newest = Math.max(new Date().getFullYear(), ...memoryYears);
    const oldest = Math.min(newest - 2, ...memoryYears);
    return Array.from({ length: newest - oldest + 1 }, (_, index) => oldest + index);
  }, [memories]);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const modePins = useMemo(() => pins.filter(pin => {
    if (mode === "places") return pin.kind === "place";
    if (mode === "memories") return pin.kind === "memory";
    return pin.kind === "memory" && Number(pin.memory.happenedOn.slice(0, 4)) <= selectedYear;
  }), [pins, mode, selectedYear]);
  const visiblePins = useMemo(() => modePins.filter(pin => activeLabels.has(pin.label)), [modePins, activeLabels]);
  const counts = useMemo(() => FILTERS.reduce<Record<PinLabel, number>>((result, filter) => {
    result[filter.id] = pins.filter(pin => pin.label === filter.id).length;
    return result;
  }, { want: 0, visited: 0, revisit: 0, memory: 0 }), [pins]);
  const neighborhoodCount = useMemo(() => new Set(places.filter(place => place.coordinates).map(place => place.district).filter(Boolean)).size, [places]);

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
        zoom: 13,
        pitch: 56,
        bearing: -18,
        attributionControl: { compact: true },
        maxPitch: 70,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
      map.once("style.load", () => {
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
    const is3d = viewMode === "3d";
    map.setLayoutProperty("buildings-3d", "visibility", is3d ? "visible" : "none");
    map.easeTo({ pitch: is3d ? 56 : 0, bearing: is3d ? -18 : 0, duration: 850 });
  }, [viewMode, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    if (selected && !visiblePins.some(pin => pin.id === selected.id)) setSelected(null);
    if (!visiblePins.length) {
      map.easeTo({ center: DEFAULT_CENTER, zoom: 12.3, pitch: viewMode === "3d" ? 56 : 0, bearing: viewMode === "3d" ? -18 : 0, duration: 600 });
      return;
    }
    void import("maplibre-gl").then(maplibregl => {
      markersRef.current = visiblePins.map(pin => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `memory-city-marker is-${pin.label} ${viewMode === "3d" ? "is-3d" : ""}`;
        element.setAttribute("aria-label", pinName(pin));
        const image = pin.kind === "memory" ? pin.memory.coverUrl : pin.place.image;
        element.innerHTML = image ? `<img src="${image}" alt=""><i></i>` : `<span>${pin.label === "visited" ? "✓" : pin.label === "revisit" ? "↻" : pin.label === "memory" ? "✦" : "♥"}</span><i></i>`;
        element.addEventListener("click", event => {
          event.stopPropagation();
          setSelected(pin);
          map.easeTo({ center: pin.coordinates, zoom: Math.max(map.getZoom(), 15.4), pitch: viewMode === "3d" ? 60 : 0, bearing: viewMode === "3d" ? -24 : 0, duration: 900, offset: [0, -70] });
        });
        return new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(pin.coordinates).addTo(map);
      });
      if (visiblePins.length === 1) {
        map.easeTo({ center: visiblePins[0].coordinates, zoom: viewMode === "3d" ? 15.2 : 14.2, pitch: viewMode === "3d" ? 58 : 0, bearing: viewMode === "3d" ? -20 : 0, duration: 900 });
      } else {
        const bounds = visiblePins.slice(1).reduce((next, pin) => next.extend(pin.coordinates), new maplibregl.LngLatBounds(visiblePins[0].coordinates, visiblePins[0].coordinates));
        map.fitBounds(bounds, { padding: { top: 150, right: 150, bottom: 190, left: 150 }, maxZoom: 14.7, duration: 900 });
        window.setTimeout(() => map.easeTo({ pitch: viewMode === "3d" ? 54 : 0, bearing: viewMode === "3d" ? -18 : 0, duration: 700 }), 500);
      }
    });
  }, [visiblePins, mapState, viewMode]);

  function toggleFilter(label: PinLabel) {
    setActiveLabels(current => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  return <div className={`couple-map-wrap memory-city ${viewMode === "3d" ? "is-3d" : "is-2d"}`}>
    <div ref={container} className="maplibre-canvas" aria-label="둘의 기억이 쌓인 3D 지도" />
    {mapState === "loading" && <div className="map-loading" role="status"><span>둘의 기억 도시를 만들고 있어요</span><i /></div>}
    {mapState === "error" && <div className="map-error" role="alert"><b>기억 지도를 불러오지 못했어요</b><span>잠시 후 다시 시도해 주세요.</span><button type="button" className="outline-button" onClick={() => setMapAttempt(value => value + 1)}>다시 불러오기</button></div>}

    <header className="memory-map-heading"><span className="eyebrow">OUR MEMORY CITY</span><h1>우리의 기억 지도</h1><p>함께한 시간이 이 도시 위에 쌓여 있어요.</p></header>

    <nav className="memory-map-modes" aria-label="지도 보기 방식">
      {([['places', '⌖', '장소'], ['memories', '▧', '추억'], ['time', '◷', '시간']] as const).map(([id, icon, label]) => <button type="button" key={id} className={mode === id ? "is-active" : ""} aria-pressed={mode === id} onClick={() => { setMode(id); setSelected(null); }}><i>{icon}</i>{label}</button>)}
    </nav>

    <div className="memory-view-switch" aria-label="지도 입체 보기"><button type="button" className={viewMode === "2d" ? "is-active" : ""} onClick={() => setViewMode("2d")}>2D</button><button type="button" className={viewMode === "3d" ? "is-active" : ""} onClick={() => setViewMode("3d")}>기억 3D</button></div>

    {mode === "time" && <div className="memory-year-track">{years.map(year => <button type="button" key={year} className={selectedYear === year ? "is-active" : ""} onClick={() => setSelectedYear(year)}><i /><span>{year}</span></button>)}</div>}

    <div className="memory-map-filters" aria-label="장소 분류">{FILTERS.map(filter => <button type="button" key={filter.id} className={`is-${filter.id} ${activeLabels.has(filter.id) ? "is-active" : ""}`} aria-pressed={activeLabels.has(filter.id)} onClick={() => toggleFilter(filter.id)}><i /><span>{filter.label}</span><b>{counts[filter.id]}</b></button>)}</div>
    <div className="memory-map-stats"><b>{neighborhoodCount}</b><span>함께한 동네</span><i /><b>{pins.length}</b><span>쌓인 장소와 추억</span></div>

    {!pins.length && <div className="memory-map-empty"><b>첫 장소가 기억 도시의 시작이에요.</b><span>둘이 좋아하는 장소를 저장하면 지도 위에 흔적이 생겨요.</span><Link href="/places">장소 둘러보기 →</Link></div>}
    {mapState === "ready" && visiblePins.length === 0 && pins.length > 0 && <div className="map-filter-empty">이 보기에는 아직 표시할 기억이 없어요.</div>}

    {selected && <aside className="memory-sheet">
      <button type="button" className="memory-sheet-close" onClick={() => setSelected(null)} aria-label="선택한 장소 닫기">×</button>
      <div className="memory-sheet-media">
        {selected.kind === "place" && selected.place.image && <img src={selected.place.image} alt="" />}
        {selected.kind === "memory" && selected.memory.coverUrl && <img src={selected.memory.coverUrl} alt="" />}
        {selected.kind === "memory" && selected.memory.photos.slice(0, 1).map(photo => <img key={photo.id} src={photo.storageUrl} alt="" />)}
        {((selected.kind === "place" && !selected.place.image) || (selected.kind === "memory" && !selected.memory.coverUrl)) && <div><span>⌖</span><small>OUR PLACE</small></div>}
      </div>
      <div className="memory-sheet-copy"><span>{selected.kind === "place" ? `${selected.place.categoryLabel} · ${selected.place.district}` : `${selected.memory.happenedOn} · ${selected.memory.locationLabel || "우리의 추억"}`}</span><h2>{pinName(selected)}</h2><p>{selected.kind === "place" ? selected.place.description || "둘의 장소로 저장했어요." : selected.memory.description || "둘만 아는 장면이에요."}</p></div>
      <Link href={selected.kind === "place" ? `/places?selected=${selected.place.id}` : "/memories"}>{selected.kind === "place" ? "장소 자세히 보기" : "추억 보러 가기"}<span>→</span></Link>
    </aside>}
  </div>;
}
