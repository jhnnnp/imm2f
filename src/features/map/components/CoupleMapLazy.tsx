"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

function MapStageFallback() {
  return (
    <div className="couple-map-wrap memory-city page-loading" aria-busy="true" aria-label="지도를 불러오는 중">
      <div className="page-loading-title" style={{ margin: "24px auto" }} />
      <div className="page-loading-copy" style={{ margin: "0 auto 24px" }} />
    </div>
  );
}

const CoupleMap = dynamic(
  () => import("./CoupleMap").then(mod => mod.CoupleMap),
  { ssr: false, loading: () => <MapStageFallback /> },
);

export function CoupleMapLazy(props: ComponentProps<typeof CoupleMap>) {
  return <CoupleMap {...props} />;
}
