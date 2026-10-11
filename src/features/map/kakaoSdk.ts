export type KakaoMap = { relayout: () => void };
export type KakaoMarker = { setMap: (map: KakaoMap | null) => void };
export type KakaoMaps = {
  load: (callback: () => void) => void;
  LatLng: new (lat: number, lng: number) => unknown;
  Map: new (container: HTMLElement, options: { center: unknown; level: number; draggable: boolean; scrollwheel: boolean }) => KakaoMap;
  Marker: new (options: { map: KakaoMap; position: unknown; title: string }) => KakaoMarker;
};

declare global {
  interface Window { kakao?: { maps: KakaoMaps } }
}

let sdkPromise: Promise<KakaoMaps> | null = null;

/** Shared across previews, but a failed/blocked SDK can always be retried. */
export function loadKakaoMaps(): Promise<KakaoMaps> {
  if (sdkPromise) return sdkPromise;
  const controller = new AbortController();
  let script: HTMLScriptElement | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const pending = new Promise<KakaoMaps>((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Kakao Maps SDK timed out."));
    }, 8_000);
    const ready = () => {
      const maps = window.kakao?.maps;
      if (!maps) { reject(new Error("Kakao Maps SDK is unavailable.")); return; }
      try { maps.load(() => resolve(maps)); } catch (error) { reject(error); }
    };
    if (window.kakao?.maps) { ready(); return; }
    void fetch("/api/kakao-map-key", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Kakao Maps configuration is unavailable.");
      const payload: unknown = await response.json();
      const key = payload && typeof payload === "object" && "key" in payload && typeof payload.key === "string" ? payload.key.trim() : "";
      if (!key || controller.signal.aborted) throw new Error("Kakao JavaScript key is not configured.");
      script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
      script.async = true;
      script.onload = ready;
      script.onerror = () => reject(new Error("Kakao Maps SDK failed to load."));
      document.head.appendChild(script);
    }).catch(reject);
  });
  sdkPromise = pending.then(maps => {
    clearTimeout(timer);
    return maps;
  }, error => {
    clearTimeout(timer);
    controller.abort();
    script?.remove();
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}
