"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_MAP_CENTER } from "../config/regions";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { PlaceCategoryIcon } from "./PlaceCategoryIcon";
import { clampRadius, distanceMeters } from "../geo";
import { isDiscoverPlace, uniqueByExternalId } from "../discover";
import { isLngLat } from "@/features/map/routing/fetchRoadRoute";
import type { Place, PlaceCategoryId } from "../types/place";
import { htmlMarkerPlacement } from "@/features/map/htmlMarker";
import { memoryCityStyle } from "@/features/map/memoryCityStyle";

const MAP_STYLE = memoryCityStyle();

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
  const markersRef = useRef<Array<{ id: string; marker: Marker }>>([]);
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  const selectionCameraRef = useRef("");
  const searchRef = useRef(onSearchHere);
  const startRef = useRef(saved.find(place => isLngLat(place.coordinates))?.coordinates ?? DEFAULT_MAP_CENTER);
  const [mapReady, setMapReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  searchRef.current = onSearchHere;
  selectRef.current = onSelect;
  selectedRef.current = selectedId;

  function searchViewport() {
    const map = mapRef.current;
    if (!map || !mapReady || error) return;
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
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame = 0;
    let readyTimer = 0;
    setMapReady(false);
    setError(false);
    selectionCameraRef.current = "";
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: startRef.current,
        zoom: 13,
        attributionControl: { compact: true },
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
        renderWorldCopies: false,
        fadeDuration: 0,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      readyTimer = window.setTimeout(() => { if (!disposed) setError(true); }, 10_000);
      map.on("style.load", () => {
        if (disposed) return;
        window.clearTimeout(readyTimer);
        setError(false);
        setMapReady(true);
      });
      map.on("moveend", () => {
        if (disposed) return;
        setMoved(true);
      });
      mapRef.current = map;
      resizeObserver = new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => { if (!disposed) map.resize(); });
      });
      resizeObserver.observe(container.current);
      map.on("webglcontextlost", event => { event.originalEvent?.preventDefault(); if (!disposed) { setMapReady(false); setError(true); } });
      map.on("webglcontextrestored", () => {
        if (disposed) return;
        map.resize();
        setError(false);
        window.clearTimeout(readyTimer);
        readyTimer = window.setTimeout(() => { if (!disposed) setError(true); }, 10_000);
      });
    }).catch(() => { if (!disposed) setError(true); });
    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!mapReady) return;
    searchViewport();
  }, [mapReady, category]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let disposed = false;
    const located = uniqueByExternalId([...saved, ...results]).flatMap(place =>
      isLngLat(place.coordinates) ? [{ place, coordinates: place.coordinates }] : [],
    );
    void import("maplibre-gl").then(maplibregl => {
      if (disposed || mapRef.current !== map) return;
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      located.forEach(({ place, coordinates }) => {
        const discover = isDiscoverPlace(place);
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = discover ? "discover-marker" : "memory-marker";
        marker.setAttribute("aria-label", `${place.name} 미리보기`);
        marker.innerHTML = discover ? `<span>·</span>` : `<i aria-hidden="true"></i><span>♥</span>`;
        if (place.id === selectedRef.current) marker.classList.add("is-selected");
        marker.setAttribute("aria-pressed", String(place.id === selectedRef.current));
        marker.addEventListener("click", () => {
          selectRef.current(place.id);
        });
        markersRef.current.push({ id: place.id, marker: new maplibregl.Marker({
          element: marker,
          ...htmlMarkerPlacement,
          anchor: discover ? "center" : "bottom",
        }).setLngLat(coordinates).addTo(map) });
      });
    });
    return () => {
      disposed = true;
    };
  }, [results, saved, mapReady]);

  useEffect(() => {
    markersRef.current.forEach(({ id, marker }) => {
      marker.getElement().classList.toggle("is-selected", id === selectedId);
      marker.getElement().setAttribute("aria-pressed", String(id === selectedId));
    });
    const map = mapRef.current;
    const selected = [...saved, ...results].find(place => place.id === selectedId);
    if (map && mapReady && isLngLat(selected?.coordinates)) {
      const key = `${selected.id}:${selected.coordinates.join(",")}`;
      if (selectionCameraRef.current !== key) {
        selectionCameraRef.current = key;
        map.easeTo({ center: selected.coordinates, zoom: Math.max(map.getZoom(), 14), duration: 500 });
      }
    } else if (!selectedId) selectionCameraRef.current = "";
  }, [selectedId, mapReady, saved, results]);

  return (
    <div className="places-map-pane">
      <div className="places-map-toolbar">
        {PLACE_CATEGORIES.map(item => (
          <button className={category === item.id ? "is-active" : ""} type="button" key={item.id} onClick={() => onCategoryChange(item.id)}><PlaceCategoryIcon category={item.id} />{item.label}</button>
        ))}
        <button className="primary-button" type="button" onClick={searchViewport} disabled={pending || !mapReady || error}>{pending ? "찾는 중..." : "이 화면에서 찾기"}</button>
      </div>
      <div className="places-map-wrap">
        <div ref={container} className="maplibre-canvas" />
        {!mapReady && !error && <div className="map-loading" role="status"><span>이 지역의 지도를 펼치고 있어요.</span><i /></div>}
        {error && <div className="map-error" role="alert"><b>지도를 불러오지 못했어요</b><span>네트워크 상태를 확인한 뒤 다시 시도해 주세요.</span><button type="button" className="outline-button" onClick={() => setAttempt(value => value + 1)}>지도 다시 열기</button></div>}
        {moved && !error && <p className="map-stale">지도를 옮겼어요. 이 화면에서 찾기를 누르면 주변 장소를 다시 가져와요.</p>}
      </div>
    </div>
  );
}
