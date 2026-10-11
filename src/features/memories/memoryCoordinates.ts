import { asPlanCoordinates } from "@/features/planning/planCoordinates";

export function parseMemoryCoordinates(latitude: string, longitude: string, fallback?: [number, number] | null): { coordinates: [number, number] | null } | { error: string } {
  const lat = latitude.trim();
  const lng = longitude.trim();
  if (!lat && !lng) return { coordinates: fallback ?? null };
  const coordinates = lat && lng ? asPlanCoordinates(Number(lng), Number(lat)) : undefined;
  return coordinates ? { coordinates } : { error: "위도와 경도를 모두 확인해 주세요. 위도는 -90~90, 경도는 -180~180 범위예요." };
}
