"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadKakaoMaps, type KakaoMap, type KakaoMarker } from "@/features/map/kakaoSdk";
import { isLngLat } from "@/features/map/routing/fetchRoadRoute";

export function PlaceLocationMap({ name, coordinates }: { name: string; coordinates: [number, number] }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [lng, lat] = coordinates;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let disposed = false;
    let kakaoMap: KakaoMap | null = null;
    let kakaoMarker: KakaoMarker | null = null;
    let fallbackMap: MapLibreMap | null = null;
    let fallbackMarker: Marker | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame = 0;
    let fallbackTimer = 0;
    setStatus("loading");
    if (!isLngLat([lng, lat])) { setStatus("error"); return; }
    const resize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        if (disposed) return;
        kakaoMap?.relayout();
        fallbackMap?.resize();
      });
    };
    const observeSize = () => {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(node);
      resize();
    };
    void loadKakaoMaps().then(maps => {
      if (disposed) return;
      const position = new maps.LatLng(lat, lng);
      kakaoMap = new maps.Map(node, { center: position, level: 4, draggable: false, scrollwheel: false });
      kakaoMarker = new maps.Marker({ map: kakaoMap, position, title: name });
      observeSize();
      setStatus("ready");
    }).catch(async () => {
      if (disposed) return;
      // A missing Kakao key must not make the saved location unusable.
      try {
        const maplibregl = await import("maplibre-gl");
        if (disposed) return;
        node.replaceChildren();
        fallbackMap = new maplibregl.Map({
          container: node,
          style: {
            version: 8,
            sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "&copy; OpenStreetMap contributors" } },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
          center: [lng, lat], zoom: 14, interactive: false,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), attributionControl: { compact: true },
        });
        fallbackMarker = new maplibregl.Marker().setLngLat([lng, lat]).addTo(fallbackMap);
        fallbackTimer = window.setTimeout(() => { if (!disposed) setStatus("error"); }, 10_000);
        fallbackMap.once("load", () => {
          window.clearTimeout(fallbackTimer);
          if (!disposed) setStatus("ready");
        });
        observeSize();
      } catch { if (!disposed) setStatus("error"); }
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      window.clearTimeout(fallbackTimer);
      resizeObserver?.disconnect();
      kakaoMarker?.setMap(null);
      fallbackMarker?.remove();
      fallbackMap?.remove();
      node.replaceChildren();
    };
  }, [lat, lng, name, attempt]);

  return <div className="place-location-map" aria-label={`${name} 위치 지도`} aria-busy={status === "loading"}>
    <div ref={container} className="kakao-place-map" />
    {status === "loading" && <div className="place-location-loading" role="status">위치를 불러오는 중이에요.</div>}
    {status === "error" && <div className="place-location-loading is-error" role="alert">지도를 불러오지 못했어요.<small>아래 지도 링크에서 위치를 확인해 주세요.</small><button type="button" className="outline-button" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div>}
  </div>;
}
