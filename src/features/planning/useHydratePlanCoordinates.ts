"use client";

import { useEffect, useRef } from "react";
import { hydrateCouplePlanCoordinates } from "./actions";
import type { PlanItem, PlanKind } from "./types/plan";
import { mergeHydratedPlanCoordinates, planCoordinateHydrateKey } from "./planCoordinates";

export function useHydratePlanCoordinates(
  kind: PlanKind,
  items: PlanItem[],
  setItems: (items: PlanItem[]) => void,
) {
  const lastKey = useRef("");
  const latest = useRef(items);
  latest.current = items;

  const key = planCoordinateHydrateKey(kind, items);
  useEffect(() => {
    if (!key) return;
    if (lastKey.current === key) return;
    lastKey.current = key;
    let cancelled = false;
    void hydrateCouplePlanCoordinates(kind).then(plan => {
      if (!cancelled) {
        setItems(mergeHydratedPlanCoordinates(latest.current, plan.items));
      }
    }).catch(() => { /* Keep the current itinerary if coordinate lookup is unavailable. */ });
    return () => {
      cancelled = true;
      if (lastKey.current === key) lastKey.current = "";
    };
  }, [kind, key, setItems]);
}
