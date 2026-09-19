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
  const latest = useRef(items);
  latest.current = items;

  const key = needsCoordinateHydrate(items) ? hydrateSignature(kind, items) : "";
  useEffect(() => {
    if (!key) return;
    if (lastKey.current === key) return;
    lastKey.current = key;
    let cancelled = false;
    void hydrateCouplePlanCoordinates(kind).then(plan => {
      if (!cancelled) {
        const coordinates = new Map(plan.items.map(item => [item.id, item.coordinates]));
        setItems(latest.current.map(item => ({ ...item, coordinates: item.coordinates ?? coordinates.get(item.id) ?? null })));
      }
    }).catch(() => { /* Keep the current itinerary if coordinate lookup is unavailable. */ });
    return () => {
      cancelled = true;
      if (lastKey.current === key) lastKey.current = "";
    };
  }, [kind, key, setItems]);
}
