import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { PlanItem } from "@/features/planning/types/plan";
import { asPlanCoordinates } from "@/features/planning/planCoordinates";
import { buildPlanRoute } from "../planRoute";

export function planItemsWithCoordinates(items: PlanItem[]) {
  return items.flatMap(item => {
    const coordinates = asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]);
    return coordinates ? [{ ...item, coordinates }] : [];
  });
}

export function syncPlanMapRoute(map: MapLibreMap, coordinates: Array<[number, number]>) {
  if (!map.isStyleLoaded()) return;
  const route = buildPlanRoute(coordinates);
  const write = (sourceId: string, data: ReturnType<typeof buildPlanRoute>[keyof ReturnType<typeof buildPlanRoute>]) => {
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  };
  write("plan-route", route.line);
  write("plan-route-segments", route.segments);
  write("plan-route-aura", route.aura);
  write("plan-route-body", route.body);
  write("plan-route-core", route.core);
  write("plan-route-stops", route.stops);
  write("plan-route-nodes", route.nodes);
}

const emptyCollection = () => ({ type: "FeatureCollection" as const, features: [] });

export function syncPlanMapRoadRoute(map: MapLibreMap, roadPath: Array<[number, number]>) {
  if (!map.isStyleLoaded() || roadPath.length < 2) return;
  const line = {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: roadPath },
    }],
  };
  const write = (sourceId: string, data: Parameters<GeoJSONSource["setData"]>[0]) => {
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  };
  write("plan-route", line);
  write("plan-route-segments", emptyCollection());
  write("plan-route-aura", emptyCollection());
  write("plan-route-body", emptyCollection());
  write("plan-route-core", emptyCollection());
  write("plan-route-stops", emptyCollection());
  write("plan-route-nodes", emptyCollection());
}
