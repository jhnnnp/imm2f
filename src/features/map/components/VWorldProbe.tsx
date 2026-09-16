"use client";

import { useEffect, useRef, useState } from "react";

type ProbeState = "loading-script" | "starting-map" | "ready" | "error";
type VWorldWindow = Window & {
  vw?: {
    Map: new () => { setOption: (options: unknown) => void; start: () => void };
    CameraPosition: new (coord: unknown, direction: unknown) => unknown;
    CoordZ: new (longitude: number, latitude: number, altitude: number) => unknown;
    Direction: new (heading: number, pitch: number, roll: number) => unknown;
    ws3dInitCallBack?: () => void;
  };
};

const SCRIPT_ID = "vworld-webgl-3";

export function VWorldProbe() {
  const startedAt = useRef(0);
  const readyRef = useRef(false);
  const [state, setState] = useState<ProbeState>("loading-script");
  const [readyIn, setReadyIn] = useState<number | null>(null);
  const [message, setMessage] = useState("브이월드 엔진을 불러오고 있어요.");
  const apiKey = process.env.NEXT_PUBLIC_VWORLD_API_KEY;

  useEffect(() => {
    const browser = window as VWorldWindow;
    startedAt.current = performance.now();
    if (!apiKey) {
      setState("error");
      setMessage("VWorld API 키가 설정되지 않았어요.");
      return;
    }

    let disposed = false;
    const fail = (messageText: string) => {
      if (!disposed) {
        setState("error");
        setMessage(messageText);
      }
    };
    const startMap = () => {
      if (disposed || !browser.vw) return;
      setState("starting-map");
      setMessage("서울의 3D 공간정보를 준비하고 있어요.");
      browser.vw.ws3dInitCallBack = () => {
        if (disposed) return;
        readyRef.current = true;
        setReadyIn(Math.round(performance.now() - startedAt.current));
        setState("ready");
        setMessage("브이월드 3D 지도가 정상적으로 연결됐어요.");
      };
      const map = new browser.vw.Map();
      map.setOption({
        mapId: "vworld-probe-map",
        initPosition: new browser.vw.CameraPosition(
          new browser.vw.CoordZ(126.978, 37.5665, 1800),
          new browser.vw.Direction(0, -55, 0),
        ),
        logo: true,
        navigation: false,
      });
      map.start();
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (browser.vw) startMap();
    else if (existing) {
      existing.addEventListener("load", startMap, { once: true });
      existing.addEventListener("error", () => fail("브이월드 스크립트를 불러오지 못했어요. 등록한 서비스 URL을 확인해 주세요."), { once: true });
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(apiKey)}`;
      script.async = true;
      script.addEventListener("load", startMap, { once: true });
      script.addEventListener("error", () => fail("브이월드 스크립트를 불러오지 못했어요. 등록한 서비스 URL을 확인해 주세요."), { once: true });
      document.head.appendChild(script);
    }

    const timeout = window.setTimeout(() => {
      if (!readyRef.current) fail("지도가 15초 안에 준비되지 않았어요. 도메인 인증이나 API 응답을 확인해 주세요.");
    }, 15_000);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      if (browser.vw) browser.vw.ws3dInitCallBack = undefined;
    };
  }, [apiKey]);

  return <section className="vworld-probe-shell">
    <div id="vworld-probe-map" className="vworld-probe-map" aria-label="브이월드 서울 3D 지도" />
    <header className="vworld-probe-intro"><span className="eyebrow">MAP ENGINE · STEP 01</span><h1>한국 3D 지도를 확인해요</h1><p>기존의 흐릿한 래스터 지도 대신 브이월드 원본 3D 공간정보를 직접 불러오는 검증 화면입니다.</p></header>
    <aside className={`vworld-probe-status is-${state}`} role="status" aria-live="polite"><i /><div><b>{state === "ready" ? "연결 완료" : state === "error" ? "연결 확인 필요" : "지도 준비 중"}</b><span>{message}</span></div>{readyIn !== null && <strong>{(readyIn / 1000).toFixed(1)}s</strong>}</aside>
    <div className="vworld-probe-note"><span>이번 단계에서 확인할 것</span><b>건물 디테일 · 첫 로딩 속도 · 카메라 조작감</b></div>
  </section>;
}
