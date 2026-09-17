"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { Memory } from "@/features/memories/types";
import type { Place, PlacePreferenceStatus } from "@/features/places/types/place";
import { htmlMarkerPlacement, screenOffsetForStackedPins } from "@/features/map/htmlMarker";

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "&copy; OpenStreetMap contributors" },
    memorymap: { type: "vector", tiles: ["/api/map-tiles/{z}/{x}/{y}"], minzoom: 0, maxzoom: 14, attribution: "&copy; OpenStreetMap contributors" },
    "trip-route": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#e8e6dc" } },
    { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.48, "raster-saturation": -0.68, "raster-contrast": -0.16, "raster-brightness-min": 0.22, "raster-brightness-max": 0.98 } },
    { id: "parks", type: "fill", source: "memorymap", "source-layer": "land", filter: ["in", ["get", "kind"], ["literal", ["park", "forest", "grass", "garden", "recreation_ground"]]], paint: { "fill-color": "#aec2aa", "fill-opacity": 0.62 } },
    { id: "water", type: "fill", source: "memorymap", "source-layer": "water_polygons", paint: { "fill-color": "#aebfc0", "fill-opacity": 0.9 } },
    { id: "roads-casing", type: "line", source: "memorymap", "source-layer": "streets", filter: ["!=", ["get", "tunnel"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#cfcbc0", "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 11, 1.2, 15, 6, 18, 17], "line-opacity": 0.86 } },
    { id: "roads", type: "line", source: "memorymap", "source-layer": "streets", filter: ["!=", ["get", "tunnel"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["match", ["get", "kind"], ["motorway", "trunk", "primary"], "#d8c3a2", "#f5f1e8"], "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 11, 0.7, 15, 3.8, 18, 12], "line-opacity": 0.96 } },
    { id: "building-footprints", type: "fill", source: "memorymap", "source-layer": "buildings", minzoom: 12, paint: { "fill-color": "#d5d2c8", "fill-outline-color": "#c5c2b9", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.2, 15, 0.76] } },
    { id: "buildings-3d", type: "fill-extrusion", source: "memorymap", "source-layer": "buildings", minzoom: 13.2, paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 12], 0, "#d9d8d0", 30, "#c7cec7", 100, "#aebdb4"], "fill-extrusion-height": ["coalesce", ["get", "height"], ["*", ["get", "levels"], 3.2], 12], "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0], "fill-extrusion-opacity": 0.84, "fill-extrusion-vertical-gradient": true } },
    { id: "trip-route-shadow", type: "line", source: "trip-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffaf0", "line-width": 13, "line-opacity": 1 } },
    { id: "trip-route-line", type: "line", source: "trip-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#b76f54", "line-width": 5, "line-opacity": 1 } },
  ],
};

const DEFAULT_CENTER: [number, number] = [126.978, 37.5665];
type PinLabel = "want" | "visited" | "revisit" | "memory";
type PlacePin = { kind: "place"; id: string; label: Exclude<PinLabel, "memory">; place: Place; coordinates: [number, number] };
type MemoryPin = { kind: "memory"; id: string; label: "memory"; memory: Memory; coordinates: [number, number] };
type TripPin = { kind: "trip"; id: string; label: "trip"; item: PlanItem; dayOrder: number; coordinates: [number, number] };
type MapPin = PlacePin | MemoryPin | TripPin;
type MapMode = "places" | "memories" | "time" | "trips";
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

function pinName(pin: MapPin) { return pin.kind === "place" ? pin.place.name : pin.kind === "memory" ? pin.memory.title : pin.item.placeName; }
function formatJourneyRange(value: string, dayCount: number) {
  if (!value) return "날짜 미정";
  const start = new Date(`${value}T00:00:00`);
  if (Number.isNaN(start.getTime())) return value;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const startLabel = `${String(start.getFullYear()).slice(-2)}.${String(start.getMonth() + 1).padStart(2, "0")}.${String(start.getDate()).padStart(2, "0")}(${weekdays[start.getDay()]})`;
  if (dayCount <= 1) return startLabel;
  const end = new Date(start);
  end.setDate(start.getDate() + dayCount - 1);
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const endLabel = sameMonth
    ? `${String(end.getDate()).padStart(2, "0")}(${weekdays[end.getDay()]})`
    : `${String(end.getFullYear()).slice(-2)}.${String(end.getMonth() + 1).padStart(2, "0")}.${String(end.getDate()).padStart(2, "0")}(${weekdays[end.getDay()]})`;
  return `${startLabel}~${endLabel}`;
}
function markerIcon(label: PinLabel) {
  const common = `viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (label === "visited") return `<svg ${common}><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg>`;
  if (label === "revisit") return `<svg ${common}><path d="M4.8 9A7.5 7.5 0 1 1 5 15.5"/><path d="M4.8 4.8V9H9"/></svg>`;
  if (label === "memory") return `<svg ${common}><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></svg>`;
  return `<svg ${common}><path d="M19.5 12.2 12 19l-7.5-6.8A4.8 4.8 0 0 1 11.3 5L12 5.8l.7-.8a4.8 4.8 0 0 1 6.8 7.2Z"/></svg>`;
}
function markerColor(label: PinLabel | "trip") {
  if (label === "visited") return "79,119,101";
  if (label === "revisit") return "181,107,91";
  if (label === "memory") return "169,126,67";
  if (label === "trip") return "63,95,80";
  return "95,143,166";
}

function framePins(map: MapLibreMap, pins: MapPin[], viewMode: ViewMode, duration = 0) {
  if (!pins.length) {
    map.easeTo({ center: DEFAULT_CENTER, zoom: 12.3, pitch: viewMode === "3d" ? 44 : 0, bearing: viewMode === "3d" ? -12 : 0, duration });
    return;
  }
  if (pins.length === 1) {
    map.easeTo({ center: pins[0].coordinates, zoom: viewMode === "3d" ? 15 : 14.2, pitch: viewMode === "3d" ? 44 : 0, bearing: viewMode === "3d" ? -12 : 0, duration });
    return;
  }

  const [[minLng, minLat], [maxLng, maxLat]] = pins.reduce<[[number, number], [number, number]]>(
    (bounds, pin) => [
      [Math.min(bounds[0][0], pin.coordinates[0]), Math.min(bounds[0][1], pin.coordinates[1])],
      [Math.max(bounds[1][0], pin.coordinates[0]), Math.max(bounds[1][1], pin.coordinates[1])],
    ],
    [[pins[0].coordinates[0], pins[0].coordinates[1]], [pins[0].coordinates[0], pins[0].coordinates[1]]],
  );
  const compact = map.getContainer().clientWidth < 640;
  const isTrip = pins[0]?.kind === "trip";
  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
    padding: compact
      ? { top: 116, right: isTrip ? 92 : 46, bottom: 92, left: isTrip ? 66 : 46 }
      : { top: 126, right: 132, bottom: 124, left: 116 },
    maxZoom: isTrip ? 13.7 : 14.2,
    pitch: viewMode === "3d" ? 42 : 0,
    bearing: viewMode === "3d" ? -12 : 0,
    duration,
  });
}
export function CoupleMap({ places: initialPlaces, memories, trip: initialTrip, archivedTrips: initialArchivedTrips }: { places: Place[]; memories: Memory[]; trip: CouplePlan; archivedTrips: ArchivedTripPlan[] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [places, setPlaces] = useState(initialPlaces);
  const [tripItems, setTripItems] = useState(initialTrip.items);
  const [tripTitle, setTripTitle] = useState(initialTrip.title || "우리가 고른 여행");
  const [tripDayCount, setTripDayCount] = useState(Math.max(1, initialTrip.dayCount));
  const [archivedTrips] = useState<ArchivedTripPlan[]>(initialArchivedTrips);
  const [selectedJourneyId, setSelectedJourneyId] = useState("current");
  const [journeyMenuOpen, setJourneyMenuOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [mode, setMode] = useState<MapMode>("places");
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [activeLabels, setActiveLabels] = useState<Set<PinLabel>>(() => new Set(FILTERS.map(item => item.id)));

  useEffect(() => {
    setPlaces(initialPlaces);
    setTripItems(initialTrip.items);
    setTripTitle(initialTrip.title || "우리가 고른 여행");
    setTripDayCount(Math.max(1, initialTrip.dayCount));
  }, [initialPlaces, initialTrip]);

  const tripJourneys = useMemo<ArchivedTripPlan[]>(() => {
    const journeys: ArchivedTripPlan[] = [
      ...(tripItems.length ? [{
        id: "current",
        title: tripTitle || "우리가 고른 여행",
        startDate: initialTrip.startDate ?? "",
        dayCount: tripDayCount,
        status: "completed" as const,
        items: tripItems,
      }] : []),
      ...archivedTrips.filter(journey => journey.items.length > 0),
    ];
    return journeys.filter((journey, index) => journeys.findIndex(candidate => candidate.startDate === journey.startDate && candidate.title === journey.title && candidate.dayCount === journey.dayCount) === index);
  }, [tripTitle, tripDayCount, tripItems, archivedTrips, initialTrip.startDate]);
  const selectedJourney = tripJourneys.find(journey => journey.id === selectedJourneyId) ?? tripJourneys[0];
  const journeyItems = selectedJourney?.items ?? [];

  const displayPlaces = places;

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    displayPlaces.forEach(place => {
      if (!place.coordinates) return;
      const label = normalizedPlaceLabel(place.userStatus);
      if (label) next.push({ kind: "place", id: `place:${place.id}`, label, place, coordinates: place.coordinates });
    });
    memories.forEach(memory => {
      if (memory.coordinates) next.push({ kind: "memory", id: `memory:${memory.id}`, label: "memory", memory, coordinates: memory.coordinates });
    });
    return next;
  }, [displayPlaces, memories]);
  const tripPins = useMemo<TripPin[]>(() => journeyItems
    .filter(item => item.coordinates)
    .sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0) || a.startTime.localeCompare(b.startTime) || a.order - b.order)
    .map((item, index) => ({ kind: "trip", id: `trip:${item.id}`, label: "trip", item, dayOrder: index + 1, coordinates: item.coordinates as [number, number] })), [journeyItems]);

  const years = useMemo(() => {
    const memoryYears = memories.map(memory => Number(memory.happenedOn.slice(0, 4))).filter(Number.isFinite);
    const newest = Math.max(new Date().getFullYear(), ...memoryYears);
    const oldest = Math.min(newest - 2, ...memoryYears);
    return Array.from({ length: newest - oldest + 1 }, (_, index) => oldest + index);
  }, [memories]);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const modePins = useMemo(() => pins.filter(pin => {
    if (mode === "trips") return false;
    if (mode === "places") return pin.kind === "place";
    if (mode === "memories") return pin.kind === "memory";
    return pin.kind === "memory" && Number(pin.memory.happenedOn.slice(0, 4)) <= selectedYear;
  }), [pins, mode, selectedYear]);
  const visiblePins = useMemo<MapPin[]>(() => mode === "trips" ? tripPins : modePins.filter(pin => pin.label !== "trip" && activeLabels.has(pin.label)), [mode, modePins, tripPins, activeLabels]);
  const visiblePinsRef = useRef(visiblePins);
  const selectedRef = useRef(selected);
  const viewModeRef = useRef(viewMode);
  visiblePinsRef.current = visiblePins;
  selectedRef.current = selected;
  viewModeRef.current = viewMode;
  const counts = useMemo(() => FILTERS.reduce<Record<PinLabel, number>>((result, filter) => {
    result[filter.id] = pins.filter(pin => pin.label === filter.id).length;
    return result;
  }, { want: 0, visited: 0, revisit: 0, memory: 0 }), [pins]);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame = 0;
    let resizeTimer: number | undefined;
    setMapState("loading");
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: DEFAULT_CENTER,
        zoom: 13,
        pitch: 44,
        bearing: -12,
        attributionControl: { compact: true },
        maxPitch: 60,
        renderWorldCopies: false,
        fadeDuration: 0,
        refreshExpiredTiles: false,
        maxTileCacheSize: 64,
        canvasContextAttributes: { antialias: false },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
      map.once("style.load", () => {
        if (disposed) return;
        map.on("movestart", () => container.current?.classList.add("is-moving"));
        map.on("moveend", () => container.current?.classList.remove("is-moving"));
        const syncOverviewState = () => container.current?.parentElement?.classList.toggle("is-map-overview", map.getZoom() < 11.5);
        map.on("zoom", syncOverviewState);
        syncOverviewState();
        map.on("click", () => {
          markersRef.current.forEach(marker => marker.getElement().classList.remove("is-selected"));
          setSelected(null);
        });
        resizeObserver = new ResizeObserver(() => {
          window.cancelAnimationFrame(resizeFrame);
          if (resizeTimer) window.clearTimeout(resizeTimer);
          resizeFrame = window.requestAnimationFrame(() => {
            map.resize();
            syncOverviewState();
            resizeTimer = window.setTimeout(() => {
              const currentSelection = selectedRef.current;
              if (currentSelection) {
                map.easeTo({ center: currentSelection.coordinates, offset: [0, -40], duration: 0 });
              } else {
                framePins(map, visiblePinsRef.current, viewModeRef.current, 0);
              }
            }, 90);
          });
        });
        if (container.current) resizeObserver.observe(container.current);
        setMapState("ready");
      });
    }).catch(() => { if (!disposed) setMapState("error"); });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      if (resizeTimer) window.clearTimeout(resizeTimer);
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
    const routeSource = map.getSource("trip-route") as GeoJSONSource | undefined;
    routeSource?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: tripPins.map(pin => pin.coordinates) },
    });
    map.setLayoutProperty("buildings-3d", "visibility", is3d ? "visible" : "none");
    map.setLayoutProperty("trip-route-shadow", "visibility", mode === "trips" ? "visible" : "none");
    map.setLayoutProperty("trip-route-line", "visibility", mode === "trips" ? "visible" : "none");
    map.easeTo({ pitch: is3d ? 44 : 0, bearing: is3d ? -12 : 0, duration: 620 });
  }, [viewMode, mapState, mode, tripPins]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    if (selected && !visiblePins.some(pin => pin.id === selected.id)) setSelected(null);
    if (!visiblePins.length) { framePins(map, [], viewMode, 480); return; }
    void import("maplibre-gl").then(maplibregl => {
      const pinCoordinates = visiblePins.map(item => item.coordinates);
      markersRef.current = visiblePins.map((pin, index) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `memory-city-marker is-${pin.label} ${viewMode === "3d" ? "is-3d" : ""}`;
        element.style.setProperty("--marker-color", markerColor(pin.label));
        const statusLabel = pin.kind === "trip" ? `${(pin.item.dayIndex ?? 0) + 1}일차 ${pin.dayOrder}번째 일정` : FILTERS.find(filter => filter.id === pin.label)?.label ?? "장소";
        element.setAttribute("aria-label", `${pinName(pin)} · ${statusLabel}`);
        const image = pin.kind === "memory" ? pin.memory.coverUrl : pin.kind === "place" ? pin.place.image : null;
        const head = image
          ? `<img src="${image}" alt="">`
          : `<span style="background:rgb(${markerColor(pin.label)})">${pin.kind === "trip" ? `<b>${pin.dayOrder}</b>` : markerIcon(pin.label)}</span>`;
        element.innerHTML = `<span class="memory-city-marker-art">${head}<i></i></span>`;
        if (selectedRef.current?.id === pin.id) element.classList.add("is-selected");
        element.addEventListener("click", event => {
          event.stopPropagation();
          markersRef.current.forEach(marker => marker.getElement().classList.remove("is-selected"));
          element.classList.add("is-selected");
          setSelected(pin);
          map.easeTo({ center: pin.coordinates, zoom: Math.max(map.getZoom(), 15.2), pitch: viewMode === "3d" ? 48 : 0, bearing: viewMode === "3d" ? -14 : 0, duration: 620, offset: [0, -48] });
        });
        const offset = screenOffsetForStackedPins(pinCoordinates, index);
        return new maplibregl.Marker({
          element,
          ...htmlMarkerPlacement,
          ...(offset ? { offset } : {}),
        }).setLngLat(pin.coordinates).addTo(map);
      });
      framePins(map, visiblePins, viewMode, 620);
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
    <div ref={container} className="maplibre-canvas" aria-label="우리의기억이 쌓인 3D 지도" />
    {mapState === "loading" && <div className="map-loading" role="status"><span>우리의기억 도시를 만들고 있어요</span><i /></div>}
    {mapState === "error" && <div className="map-error" role="alert"><b>기억 지도를 불러오지 못했어요</b><span>잠시 후 다시 시도해 주세요.</span><button type="button" className="outline-button" onClick={() => setMapAttempt(value => value + 1)}>다시 불러오기</button></div>}

    <header className="memory-map-heading"><span className="eyebrow">OUR MAP</span><h1>우리의 기억 지도</h1></header>
    <div className={`memory-map-toolbar ${mode === "trips" ? "is-trip-mode" : ""}`}>
      <nav className="memory-map-modes" aria-label="지도 보기 방식">
        {([['places', '장소'], ['memories', '추억'], ['time', '시간'], ['trips', '여행']] as const).map(([id, label]) => <button type="button" key={id} className={mode === id ? "is-active" : ""} aria-pressed={mode === id} onClick={() => { setMode(id); setSelected(null); }}>{label}</button>)}
      </nav>
      <div className="memory-map-right-tools">
        {mode === "time" && <div className="memory-year-picker" aria-label="연도 선택">{years.map(year => <button type="button" key={year} className={selectedYear === year ? "is-active" : ""} aria-pressed={selectedYear === year} onClick={() => { setSelectedYear(year); setSelected(null); }}>{year}</button>)}</div>}
        {mode === "trips" && selectedJourney && <div className="memory-trip-summary" aria-label={`${selectedJourney.title} 일정`}>
          <div className="memory-trip-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setJourneyMenuOpen(false); }}>
            <button type="button" className="memory-trip-picker-trigger" aria-haspopup="listbox" aria-expanded={journeyMenuOpen} onClick={() => setJourneyMenuOpen(value => !value)}><span>{formatJourneyRange(selectedJourney.startDate, selectedJourney.dayCount)}</span><b>{selectedJourney.title}</b><i aria-hidden="true">⌄</i></button>
            {journeyMenuOpen && <div className="memory-trip-picker-menu" role="listbox" aria-label="여행 선택">{tripJourneys.map(journey => <button type="button" role="option" aria-selected={journey.id === selectedJourneyId} key={journey.id} onClick={() => { setSelectedJourneyId(journey.id); setSelected(null); setJourneyMenuOpen(false); }}><span>{formatJourneyRange(journey.startDate, journey.dayCount)}</span><b>{journey.title}</b></button>)}</div>}
          </div>
          <span>{journeyItems.length}곳</span>
        </div>}
        <div className="memory-view-switch" aria-label="지도 입체 보기"><button type="button" className={viewMode === "2d" ? "is-active" : ""} onClick={() => setViewMode("2d")}>2D</button><button type="button" className={viewMode === "3d" ? "is-active" : ""} onClick={() => setViewMode("3d")}>3D</button></div>
      </div>
    </div>

    {mode !== "trips" && <div className="memory-map-filters" aria-label="장소 분류">{FILTERS.map(filter => <button type="button" key={filter.id} className={`is-${filter.id} ${activeLabels.has(filter.id) ? "is-active" : ""}`} aria-pressed={activeLabels.has(filter.id)} onClick={() => toggleFilter(filter.id)}><i /><span>{filter.label}</span><b>{counts[filter.id]}</b></button>)}</div>}

    {mode === "trips" && selectedJourney && <div className="memory-map-stats"><b>{formatJourneyRange(selectedJourney.startDate, selectedJourney.dayCount)}</b><span>{tripPins.length}곳</span><i /><span>여행 전체 동선</span></div>}

    {mode === "trips" && !selectedJourney && <div className="memory-map-empty"><b>아직 지도에 올릴 여행이 없어요.</b><span>여행 일정에 장소를 담으면 동선이 보여요.</span><Link href="/trip">여행 짜기 →</Link></div>}
    {mode !== "trips" && !pins.length && <div className="memory-map-empty"><b>첫 장소가 기억 도시의 시작이에요.</b><span>둘이 좋아하는 장소를 저장하면 지도 위에 흔적이 생겨요.</span><Link href="/places">장소 둘러보기 →</Link></div>}
    {mapState === "ready" && mode !== "trips" && visiblePins.length === 0 && pins.length > 0 && <div className="map-filter-empty">이 보기에는 아직 표시할 기억이 없어요.</div>}

    {selected && <aside className="memory-sheet">
      <button type="button" className="memory-sheet-close" onClick={() => { markersRef.current.forEach(marker => marker.getElement().classList.remove("is-selected")); setSelected(null); }} aria-label="선택한 장소 닫기">×</button>
      <div className="memory-sheet-media">
        {selected.kind === "place" && selected.place.image && <img src={selected.place.image} alt="" />}
        {selected.kind === "memory" && selected.memory.coverUrl && <img src={selected.memory.coverUrl} alt="" />}
        {selected.kind === "memory" && selected.memory.photos.slice(0, 1).map(photo => <img key={photo.id} src={photo.storageUrl} alt="" />)}
        {((selected.kind === "place" && !selected.place.image) || (selected.kind === "memory" && !selected.memory.coverUrl) || selected.kind === "trip") && <div><span>{selected.kind === "trip" ? selected.dayOrder : "⌖"}</span><small>{selected.kind === "trip" ? selected.item.startTime : "OUR PLACE"}</small></div>}
      </div>
      <div className="memory-sheet-copy"><span>{selected.kind === "place" ? `${selected.place.categoryLabel} · ${selected.place.district}` : selected.kind === "memory" ? `${selected.memory.happenedOn} · ${selected.memory.locationLabel || "우리의 추억"}` : `${(selected.item.dayIndex ?? 0) + 1}일차 ${selected.item.startTime} · ${selected.item.category}`}</span><h2>{pinName(selected)}</h2><p>{selected.kind === "place" ? selected.place.description || "우리의 장소로 저장했어요." : selected.kind === "memory" ? selected.memory.description || "우리의  아는 장면이에요." : selected.item.memo}</p></div>
      <Link href={selected.kind === "place" ? `/places?selected=${selected.place.id}` : selected.kind === "memory" ? "/memories" : "/trip"}>{selected.kind === "place" ? "장소 자세히 보기" : selected.kind === "memory" ? "추억 보러 가기" : "여행 일정 보기"}<span>→</span></Link>
    </aside>}
  </div>;
}
