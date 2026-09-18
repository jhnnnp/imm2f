"use client";

import { useEffect, useRef } from "react";
import { hydrateCouplePlanCoordinates } from "./actions";
import type { PlanItem, PlanKind } from "./types/plan";
import { asPlanCoordinates } from "./planCoordinates";

function needsCoordinateHydrate(items: PlanItem[]) {
  return items.some(item => !asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]));
}

function hydrateSignature(kind: PlanKind, items: PlanItem[]) {
  return `${kind}:${items.length}:${items.map(item => item.id).join("|")}`;
}

export function useHydratePlanCoordinates(
  kind: PlanKind,
  items: PlanItem[],
  setItems: (items: PlanItem[]) => void,
) {
  const lastKey = useRef("");

  useEffect(() => {
    if (!needsCoordinateHydrate(items)) return;
    const key = hydrateSignature(kind, items);
    if (lastKey.current === key) return;
    lastKey.current = key;
    let cancelled = false;
    void hydrateCouplePlanCoordinates(kind).then(plan => {
      if (!cancelled) setItems(plan.items);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, items, setItems]);
}
