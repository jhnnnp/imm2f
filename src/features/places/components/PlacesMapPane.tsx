"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_MAP_CENTER } from "../config/regions";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { PlaceCategoryIcon } from "./PlaceCategoryIcon";
import { clampRadius, distanceMeters } from "../geo";
import { isDiscoverPlace } from "../discover";
import type { Place, PlaceCategoryId } from "../types/place";
import { htmlMarkerPlacement } from "@/features/map/htmlMarker";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function PlacesMapPane({
  saved,
  results,
  selectedId,
  category,
  pending,
  onCategoryChange,
  onSelect,
  onSearchHere,
}: {
  saved: Place[];
  results: Place[];
  selectedId: string;
  category: PlaceCategoryId | "all";
  pending: boolean;
  onCategoryChange: (category: PlaceCategoryId | "all") => void;
  onSelect: (id: string) => void;
  onSearchHere: (input: { x: number; y: number; radius: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const searchRef = useRef(onSearchHere);
  const startRef = useRef(saved.find(place => place.coordinates)?.coordinates ?? DEFAULT_MAP_CENTER);
  const [mapReady, setMapReady] = useState(false);
  const [moved, setMoved] = useState(false);
  searchRef.current = onSearchHere;

  function searchViewport() {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const ne = map.getBounds().getNorthEast();
    setMoved(false);
    searchRef.current({
      x: center.lng,
      y: center.lat,
      radius: clampRadius(distanceMeters([center.lng, center.lat], [ne.lng, ne.lat])),
    });
  }

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: startRef.current,
        zoom: 13,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.once("style.load", () => {
        if (disposed) return;
        setMapReady(true);
      });
      map.on("moveend", () => {
        if (disposed) return;
        setMoved(true);
      });
      mapRef.current = map;
    });
    return () => {
      disposed = true;
      setMapReady(false);
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    searchViewport();
  }, [mapReady, category]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let disposed = false;
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !mapRef.current) return;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      const seen = new Set<string>();
      [...results, ...saved].forEach(place => {
        if (!place.coordinates) return;
        const key = place.externalPlaceId || place.id;
        if (seen.has(key)) return;
        seen.add(key);
        const discover = isDiscoverPlace(place);
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = discover ? "discover-marker" : "memory-marker";
        marker.setAttribute("aria-label", `${place.name} 미리보기`);
        marker.innerHTML = discover ? `<span>·</span>` : `<i aria-hidden="true"></i><span>♥</span>`;
        if (place.id === selectedId) marker.classList.add("is-selected");
        marker.addEventListener("click", () => {
          onSelect(place.id);
          map.flyTo({ center: place.coordinates!, zoom: Math.max(map.getZoom(), 14), duration: 600 });
        });
        markersRef.current.push(new maplibregl.Marker({
          element: marker,
          ...htmlMarkerPlacement,
          anchor: discover ? "center" : "bottom",
        }).setLngLat(place.coordinates).addTo(map));
      });
    });
    return () => {
      disposed = true;
    };
  }, [results, saved, selectedId, onSelect, mapReady]);

  return (
    <div className="places-map-pane">
      <div className="places-map-toolbar">
        {PLACE_CATEGORIES.map(item => (
          <button className={category === item.id ? "is-active" : ""} type="button" key={item.id} onClick={() => onCategoryChange(item.id)}><PlaceCategoryIcon category={item.id} />{item.label}</button>
        ))}
        <button className="primary-button" type="button" onClick={searchViewport} disabled={pending}>{pending ? "찾는 중..." : "이 화면에서 찾기"}</button>
      </div>
      <div className="places-map-wrap">
        <div ref={container} className="maplibre-canvas" />
        {!mapReady && <div className="map-loading"><span>이 지역의 지도를 펼치고 있어요.</span><i /></div>}
        {moved && <p className="map-stale">지도를 옮겼어요. 이 화면에서 찾기를 누르면 주변 장소를 다시 가져와요.</p>}
      </div>
    </div>
  );
}
