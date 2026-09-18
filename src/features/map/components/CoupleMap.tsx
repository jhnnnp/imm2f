"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { Memory } from "@/features/memories/types";
import type { Place } from "@/features/places/types/place";
import { htmlMarkerPlacement, screenOffsetForStackedPins } from "@/features/map/htmlMarker";
import { computeMemorySheetAnchor, pinScreenPoints, type MemorySheetAnchor } from "@/features/map/memorySheetAnchor";
import { emptyGeoJsonSource, memoryCityStyle } from "@/features/map/memoryCityStyle";
import { couplePlacePinFromPartner, couplePlacePinLabel } from "@/features/map/placePins";
import { distanceMeters } from "@/features/places/geo";
import { asPlanCoordinates } from "@/features/planning/planCoordinates";
import { curveRoute } from "@/features/trip/planRoute";
import { useRoadRoute } from "@/features/map/routing/useRoadRoute";
import { MapRouteOverlay } from "./MapRouteOverlay";

const MAP_STYLE: StyleSpecification = memoryCityStyle({
  sources: {
    "trip-route": emptyGeoJsonSource(true),
  },
  layers: [
    { id: "trip-route-shadow", type: "line", source: "trip-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#faf7e8", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 13, 16, 16], "line-opacity": 0.94 } },
    { id: "trip-route-line", type: "line", source: "trip-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e3de96", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5, 12, 7, 16, 9], "line-opacity": 0.9 } },
    { id: "trip-route-inner", type: "line", source: "trip-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f3f0cc", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.2, 12, 3, 16, 3.6], "line-opacity": 0.82 } },
    { id: "trip-route-flow", type: "line", source: "trip-route", layout: { visibility: "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffef5", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 12, 1.5, 16, 2], "line-opacity": 0.65, "line-dasharray": [1.1, 2.8] } },
  ],
});

const TRIP_ROUTE_LAYERS = ["trip-route-shadow", "trip-route-line", "trip-route-inner", "trip-route-flow"] as const;

function tripRouteCollection(pins: TripPin[]) {
  const coordinates = pins.flatMap(pin => {
    const coords = asPlanCoordinates(pin.coordinates[0], pin.coordinates[1]);
    return coords ? [coords] : [];
  });
  if (coordinates.length < 2) {
    return { type: "FeatureCollection" as const, features: [] };
  }
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: curveRoute(coordinates) },
    }],
  };
}

function syncCoupleTripRoute(map: MapLibreMap, pins: TripPin[], show: boolean) {
  if (!map.isStyleLoaded()) return;
  const routeSource = map.getSource("trip-route") as GeoJSONSource | undefined;
  routeSource?.setData(tripRouteCollection(pins));
  const visibility = show && pins.length >= 2 ? "visible" : "none";
  for (const layerId of TRIP_ROUTE_LAYERS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}

const DEFAULT_CENTER: [number, number] = [126.978, 37.5665];
const EMPTY_JOURNEY_ITEMS: PlanItem[] = [];
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

function pinName(pin: MapPin) { return pin.kind === "place" ? pin.place.name : pin.kind === "memory" ? pin.memory.title : pin.item.placeName; }
function sheetEyebrow(pin: MapPin) {
  if (pin.kind === "place") return `${pin.place.categoryLabel} · ${pin.place.district}`;
  if (pin.kind === "memory") return `${pin.memory.happenedOn} · ${pin.memory.locationLabel || "우리의 추억"}`;
  return `${(pin.item.dayIndex ?? 0) + 1}일차 ${pin.item.startTime} · ${pin.item.category}`;
}
function sheetDescription(pin: MapPin, previousCoordinates?: [number, number]) {
  if (pin.kind === "place") return pin.place.description || "우리의 장소로 저장했어요.";
  if (pin.kind === "memory") return pin.memory.description || "우리만 아는 장면이에요.";
  if (previousCoordinates) {
    const meters = Math.round(distanceMeters(previousCoordinates, pin.coordinates));
    if (meters < 80) return "앞에서 바로 옆";
    if (meters < 1000) return `앞에서 ${meters}m`;
    return `앞에서 ${(meters / 1000).toFixed(1)}km`;
  }
  return pin.item.memo || "여행 일정에 담아 둔 장소예요.";
}
function sheetHref(pin: MapPin) {
  if (pin.kind === "place") return `/places?selected=${pin.place.id}`;
  if (pin.kind === "memory") return "/memories";
  return "/trip";
}
function sheetAction(pin: MapPin) {
  if (pin.kind === "place") return "자세히";
  if (pin.kind === "memory") return "추억";
  return "일정";
}
function sheetActionLabel(pin: MapPin) {
  if (pin.kind === "place") return "장소 자세히 보기";
  if (pin.kind === "memory") return "추억 보러 가기";
  return "여행 일정 보기";
}
function sheetChevron() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`;
}
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

type MapViewportSnapshot = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

function captureMapViewport(map: MapLibreMap): MapViewportSnapshot {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function restoreMapViewport(map: MapLibreMap, snapshot: MapViewportSnapshot, duration = 620) {
  map.easeTo({
    center: snapshot.center,
    zoom: snapshot.zoom,
    bearing: snapshot.bearing,
    pitch: snapshot.pitch,
    duration,
  });
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
  const mapHostRef = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const selectionViewportRef = useRef<MapViewportSnapshot | null>(null);
  const clearMapSelectionRef = useRef<(restoreView?: boolean) => void>(() => {});
  const [places, setPlaces] = useState(initialPlaces);
  const [tripItems, setTripItems] = useState(initialTrip.items);
  const [tripTitle, setTripTitle] = useState(initialTrip.title || "우리가 고른 여행");
  const [tripDayCount, setTripDayCount] = useState(Math.max(1, initialTrip.dayCount));
  const [archivedTrips] = useState<ArchivedTripPlan[]>(initialArchivedTrips);
  const [selectedJourneyId, setSelectedJourneyId] = useState("current");
  const [journeyMenuOpen, setJourneyMenuOpen] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [selected, setSelected] = useState<MapPin | null>(null);
  const [sheetAnchor, setSheetAnchor] = useState<MemorySheetAnchor | null>(null);
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
  const journeyItems = selectedJourney?.items ?? EMPTY_JOURNEY_ITEMS;

  const displayPlaces = places;

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    displayPlaces.forEach(place => {
      if (!place.coordinates) return;
      const label = couplePlacePinLabel(place);
      if (label) next.push({ kind: "place", id: `place:${place.id}`, label, place, coordinates: place.coordinates });
    });
    memories.forEach(memory => {
      if (memory.coordinates) next.push({ kind: "memory", id: `memory:${memory.id}`, label: "memory", memory, coordinates: memory.coordinates });
    });
    return next;
  }, [displayPlaces, memories]);
  const tripPins = useMemo<TripPin[]>(() => journeyItems
    .flatMap(item => {
      const coordinates = asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]);
      return coordinates ? [{ item, coordinates }] : [];
    })
    .sort((a, b) => (a.item.dayIndex ?? 0) - (b.item.dayIndex ?? 0) || a.item.startTime.localeCompare(b.item.startTime) || a.item.order - b.item.order)
    .map(({ item, coordinates }, index) => ({
      kind: "trip" as const,
      id: `trip:${item.id}`,
      label: "trip" as const,
      item,
      dayOrder: index + 1,
      coordinates,
    })), [journeyItems]);

  const tripCoordinateList = useMemo(
    () => tripPins.map(pin => pin.coordinates),
    [tripPins],
  );
  const { path: tripRoadPath } = useRoadRoute(
    tripCoordinateList,
    mapState === "ready" && mode === "trips" && tripCoordinateList.length >= 2,
    "driving",
  );

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
  const visiblePins = useMemo<MapPin[]>(() => {
    if (mode === "trips") return tripPins;
    return modePins.filter(pin => pin.label !== "trip" && activeLabels.has(pin.label));
  }, [mode, modePins, tripPins, activeLabels]);
  const visiblePinsRef = useRef(visiblePins);
  const tripPinsRef = useRef(tripPins);
  const modeRef = useRef(mode);
  const selectedRef = useRef(selected);
  const viewModeRef = useRef(viewMode);
  visiblePinsRef.current = visiblePins;
  tripPinsRef.current = tripPins;
  modeRef.current = mode;
  selectedRef.current = selected;
  viewModeRef.current = viewMode;
  const counts = useMemo(() => FILTERS.reduce<Record<PinLabel, number>>((result, filter) => {
    result[filter.id] = pins.filter(pin => pin.label === filter.id).length;
    return result;
  }, { want: 0, visited: 0, revisit: 0, memory: 0 }), [pins]);

  const clearMapSelection = useCallback((restoreView = true) => {
    markersRef.current.forEach(marker => marker.getElement().classList.remove("is-selected"));
    const map = mapRef.current;
    const saved = restoreView ? selectionViewportRef.current : null;
    selectionViewportRef.current = null;
    setSelected(null);
    if (map && saved) restoreMapViewport(map, saved, 620);
  }, []);

  clearMapSelectionRef.current = clearMapSelection;

  const updateSheetAnchor = useCallback(() => {
    const map = mapRef.current;
    const pin = selectedRef.current;
    const mapContainer = container.current;
    const mapHost = mapHostRef.current;
    if (!map || !pin || !mapContainer || !mapHost) {
      setSheetAnchor(null);
      return;
    }
    const pins = visiblePinsRef.current;
    const pinCoordinates = pins.map(item => item.coordinates);
    const index = pins.findIndex(item => item.id === pin.id);
    if (index < 0) {
      setSheetAnchor(null);
      return;
    }
    const screenOffsets = pinCoordinates.map((_, offsetIndex) => screenOffsetForStackedPins(pinCoordinates, offsetIndex));
    const sheetEl = sheetRef.current;
    const sheetWidth = sheetEl?.offsetWidth ?? 200;
    const sheetHeight = sheetEl?.offsetHeight ?? 54;
    const otherPinPoints = pinScreenPoints(map, mapContainer, mapHost, pins, screenOffsets, pin.id);
    const next = computeMemorySheetAnchor({
      map,
      mapContainer,
      mapHost,
      coordinates: pin.coordinates,
      screenOffset: screenOffsets[index],
      sheetWidth,
      sheetHeight,
      otherPinPoints,
    });
    setSheetAnchor(current => (
      current
      && current.x === next.x
      && current.y === next.y
      && current.placement === next.placement
        ? current
        : next
    ));
  }, []);

  useLayoutEffect(() => {
    if (!selected) {
      setSheetAnchor(null);
      return;
    }
    updateSheetAnchor();
    const frame = window.requestAnimationFrame(updateSheetAnchor);
    const map = mapRef.current;
    const onMapChange = () => window.requestAnimationFrame(updateSheetAnchor);
    map?.on("move", onMapChange);
    map?.on("zoom", onMapChange);
    map?.on("rotate", onMapChange);
    map?.on("pitch", onMapChange);
    map?.on("resize", onMapChange);
    window.addEventListener("resize", onMapChange);
    return () => {
      window.cancelAnimationFrame(frame);
      map?.off("move", onMapChange);
      map?.off("zoom", onMapChange);
      map?.off("rotate", onMapChange);
      map?.off("pitch", onMapChange);
      map?.off("resize", onMapChange);
      window.removeEventListener("resize", onMapChange);
    };
  }, [selected, updateSheetAnchor]);
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
      setMapInstance(map);
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
      map.once("style.load", () => {
        if (disposed) return;
        map.on("movestart", () => container.current?.classList.add("is-moving"));
        map.on("moveend", () => container.current?.classList.remove("is-moving"));
        const syncOverviewState = () => container.current?.parentElement?.classList.toggle("is-map-overview", map.getZoom() < 11.5);
        map.on("zoom", syncOverviewState);
        syncOverviewState();
        map.on("click", () => {
          clearMapSelectionRef.current(true);
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
        for (const layerId of TRIP_ROUTE_LAYERS) {
          if (map.getLayer(layerId)) map.moveLayer(layerId);
        }
        setMapState("ready");
      });
      map.once("load", () => {
        syncCoupleTripRoute(map, tripPinsRef.current, modeRef.current === "trips");
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
      setMapInstance(null);
    };
  }, [mapAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    const is3d = viewMode === "3d";
    const showTripRoute = mode === "trips";
    if (showTripRoute && tripRoadPath && tripRoadPath.length >= 2) {
      const routeSource = map.getSource("trip-route") as GeoJSONSource | undefined;
      routeSource?.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: tripRoadPath },
        }],
      });
      syncCoupleTripRoute(map, tripPins, false);
      for (const layerId of TRIP_ROUTE_LAYERS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "visible");
      }
    } else {
      syncCoupleTripRoute(map, tripPins, showTripRoute);
    }
    map.setLayoutProperty("buildings-3d", "visibility", is3d ? "visible" : "none");
    if (map.getLayer("buildings-3d")) {
      map.setPaintProperty("buildings-3d", "fill-extrusion-opacity", showTripRoute && is3d ? 0.38 : 0.84);
    }
    map.easeTo({ pitch: is3d ? 44 : 0, bearing: is3d ? -12 : 0, duration: 620 });
    map.triggerRepaint();
  }, [viewMode, mapState, mode, tripPins, tripRoadPath]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    const currentSelection = selectedRef.current;
    if (currentSelection && !visiblePins.some(pin => pin.id === currentSelection.id)) clearMapSelection(false);
    if (!visiblePins.length) { framePins(map, [], viewMode, 480); return; }
    void import("maplibre-gl").then(maplibregl => {
      const pinCoordinates = visiblePins.map(item => item.coordinates);
      markersRef.current = visiblePins.map((pin, index) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `memory-city-marker is-${pin.label} ${viewMode === "3d" ? "is-3d" : ""}`;
        element.style.setProperty("--marker-color", markerColor(pin.label));
        const statusLabel = pin.kind === "trip"
          ? `${(pin.item.dayIndex ?? 0) + 1}일차 ${pin.dayOrder}번째 일정`
          : pin.kind === "place" && couplePlacePinFromPartner(pin.place)
            ? `${FILTERS.find(filter => filter.id === pin.label)?.label ?? "장소"} · 파트너가 남긴 곳`
            : FILTERS.find(filter => filter.id === pin.label)?.label ?? "장소";
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
          if (!selectedRef.current) selectionViewportRef.current = captureMapViewport(map);
          setSelected(pin);
          map.easeTo({ center: pin.coordinates, zoom: Math.max(map.getZoom(), 15.2), pitch: viewMode === "3d" ? 48 : 0, bearing: viewMode === "3d" ? -14 : 0, duration: 620, offset: [0, -24] });
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
  }, [visiblePins, mapState, viewMode, clearMapSelection]);

  function toggleFilter(label: PinLabel) {
    setActiveLabels(current => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  const tripRouteAnchors = useMemo(
    () => {
      const coordinates = tripPins.map(pin => pin.coordinates);
      return tripPins.map((pin, index) => ({
        coordinates: pin.coordinates,
        screenOffset: screenOffsetForStackedPins(coordinates, index),
      }));
    },
    [tripPins],
  );

  const selectedPinIndex = selected ? visiblePins.findIndex(pin => pin.id === selected.id) : -1;
  const previousPinCoordinates = selectedPinIndex > 0 ? visiblePins[selectedPinIndex - 1]?.coordinates : undefined;

  return <div ref={mapHostRef} className={`couple-map-wrap memory-city ${viewMode === "3d" ? "is-3d" : "is-2d"}`}>
    <div ref={container} className="maplibre-canvas" aria-label="우리의기억이 쌓인 3D 지도" />
    <MapRouteOverlay
      map={mapInstance}
      anchors={tripRouteAnchors}
      pinVariant="memory"
      active={mapState === "ready" && mode === "trips" && tripRouteAnchors.length >= 2}
    />
    {mapState === "loading" && <div className="map-loading" role="status"><span>우리의기억 도시를 만들고 있어요</span><i /></div>}
    {mapState === "error" && <div className="map-error" role="alert"><b>기억 지도를 불러오지 못했어요</b><span>잠시 후 다시 시도해 주세요.</span><button type="button" className="outline-button" onClick={() => setMapAttempt(value => value + 1)}>다시 불러오기</button></div>}

    <header className="memory-map-heading"><span className="eyebrow">OUR MAP</span><h1>우리의 기억 지도</h1></header>
    <div className={`memory-map-toolbar ${mode === "trips" ? "is-trip-mode" : ""}`}>
      <nav className="memory-map-modes" aria-label="지도 보기 방식">
        {([['places', '장소'], ['memories', '추억'], ['time', '시간'], ['trips', '여행']] as const).map(([id, label]) => <button type="button" key={id} className={mode === id ? "is-active" : ""} aria-pressed={mode === id} onClick={() => { clearMapSelection(false); setMode(id); }}>{label}</button>)}
      </nav>
      <div className="memory-map-right-tools">
        {mode === "time" && <div className="memory-year-picker" aria-label="연도 선택">{years.map(year => <button type="button" key={year} className={selectedYear === year ? "is-active" : ""} aria-pressed={selectedYear === year} onClick={() => { clearMapSelection(false); setSelectedYear(year); }}>{year}</button>)}</div>}
        {mode === "trips" && selectedJourney && <div className="memory-trip-summary" aria-label={`${selectedJourney.title} 일정`}>
          <div className="memory-trip-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setJourneyMenuOpen(false); }}>
            <button type="button" className="memory-trip-picker-trigger" aria-haspopup="listbox" aria-expanded={journeyMenuOpen} onClick={() => setJourneyMenuOpen(value => !value)}><span>{formatJourneyRange(selectedJourney.startDate, selectedJourney.dayCount)}</span><b>{selectedJourney.title}</b><i aria-hidden="true">⌄</i></button>
            {journeyMenuOpen && <div className="memory-trip-picker-menu" role="listbox" aria-label="여행 선택">{tripJourneys.map(journey => <button type="button" role="option" aria-selected={journey.id === selectedJourneyId} key={journey.id} onClick={() => { clearMapSelection(false); setSelectedJourneyId(journey.id); setJourneyMenuOpen(false); }}><span>{formatJourneyRange(journey.startDate, journey.dayCount)}</span><b>{journey.title}</b></button>)}</div>}
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

    {selected && <aside
      ref={sheetRef}
      className={`memory-sheet is-pin-anchored ${sheetAnchor?.placement === "bottom" ? "is-anchor-bottom" : "is-anchor-top"}`}
      style={sheetAnchor ? ({ "--sheet-x": `${sheetAnchor.x}px`, "--sheet-y": `${sheetAnchor.y}px` } as CSSProperties) : undefined}
      data-anchor-ready={sheetAnchor ? "true" : "false"}
      role="dialog"
      aria-labelledby="memory-sheet-title"
    >
      <button type="button" className="memory-sheet-close" onClick={() => clearMapSelection(true)} aria-label="선택한 장소 닫기">
        <span aria-hidden="true" />
      </button>
      <div className="memory-sheet-card">
        <div className="memory-sheet-media">
          {selected.kind === "place" && selected.place.image && <img src={selected.place.image} alt="" />}
          {selected.kind === "memory" && selected.memory.coverUrl && <img src={selected.memory.coverUrl} alt="" />}
          {selected.kind === "memory" && !selected.memory.coverUrl && selected.memory.photos.slice(0, 1).map(photo => <img key={photo.id} src={photo.storageUrl} alt="" />)}
          {((selected.kind === "place" && !selected.place.image) || (selected.kind === "memory" && !selected.memory.coverUrl && !selected.memory.photos.length) || selected.kind === "trip") && (
            <div className={`memory-sheet-fallback is-${selected.kind === "trip" ? "trip" : selected.kind === "memory" ? "memory" : selected.label}`}>
              {selected.kind === "trip"
                ? <span className="memory-sheet-fallback-badge">{selected.dayOrder}</span>
                : <span className="memory-sheet-fallback-icon" dangerouslySetInnerHTML={{ __html: markerIcon(selected.kind === "memory" ? "memory" : selected.label) }} />}
            </div>
          )}
        </div>
        <div className="memory-sheet-body">
          <p className="memory-sheet-meta">{sheetEyebrow(selected)}</p>
          <div className="memory-sheet-title-row">
            <h2 id="memory-sheet-title">{pinName(selected)}</h2>
            <Link className="memory-sheet-cta" href={sheetHref(selected)} aria-label={sheetActionLabel(selected)}>
              <span aria-hidden="true">{sheetAction(selected)}</span>
              <span className="memory-sheet-cta-icon" dangerouslySetInnerHTML={{ __html: sheetChevron() }} />
            </Link>
          </div>
          <p className="memory-sheet-lead">{sheetDescription(selected, previousPinCoordinates)}</p>
        </div>
      </div>
    </aside>}
  </div>;
}
