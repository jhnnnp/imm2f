"use client";

import { useEffect, useRef, useState } from "react";

type KakaoMap = { relayout: () => void };
type KakaoMarker = { setMap: (map: KakaoMap | null) => void };
type KakaoMaps = {
  load: (callback: () => void) => void;
  LatLng: new (lat: number, lng: number) => unknown;
  Map: new (container: HTMLElement, options: { center: unknown; level: number; draggable: boolean; scrollwheel: boolean }) => KakaoMap;
  Marker: new (options: { map: KakaoMap; position: unknown; title: string }) => KakaoMarker;
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

let kakaoMapsPromise: Promise<KakaoMaps> | null = null;

function loadKakaoMaps() {
  if (window.kakao?.maps) {
    return new Promise<KakaoMaps>(resolve => window.kakao!.maps.load(() => resolve(window.kakao!.maps)));
  }
  if (kakaoMapsPromise) return kakaoMapsPromise;
  kakaoMapsPromise = fetch("/api/kakao-map-key")
    .then(response => response.json() as Promise<{ key?: string }>)
    .then(({ key }) => new Promise<KakaoMaps>((resolve, reject) => {
      if (!key) {
        reject(new Error("Kakao JavaScript key is not configured."));
        return;
      }
      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      script.async = true;
      script.onload = () => window.kakao?.maps.load(() => resolve(window.kakao!.maps));
      script.onerror = () => reject(new Error("Kakao Maps SDK failed to load."));
      document.head.appendChild(script);
    }));
  return kakaoMapsPromise;
}

export function PlaceLocationMap({ name, coordinates }: { name: string; coordinates: [number, number] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markerRef = useRef<KakaoMarker | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [lng, lat] = coordinates;

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    setStatus("loading");
    void loadKakaoMaps().then(maps => {
      if (disposed || !container.current) return;
      const position = new maps.LatLng(lat, lng);
      const map = new maps.Map(container.current, { center: position, level: 4, draggable: false, scrollwheel: false });
      mapRef.current = map;
      markerRef.current = new maps.Marker({ map, position, title: name });
      requestAnimationFrame(() => map.relayout());
      setStatus("ready");
    }).catch(() => {
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [lat, lng, name]);

  return <div className="place-location-map" aria-label={`${name} 위치 지도`}>
    <div ref={container} className="kakao-place-map" />
    {status === "loading" && <div className="place-location-loading">위치를 불러오는 중이에요.</div>}
    {status === "error" && <div className="place-location-loading is-error">지도를 불러오지 못했어요.<small>아래 지도 링크에서 위치를 확인해 주세요.</small></div>}
  </div>;
}
