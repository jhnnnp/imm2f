import type { Map as MapLibreMap } from "maplibre-gl";

export type MemorySheetPlacement = "top" | "bottom";

export type MemorySheetAnchor = {
  x: number;
  y: number;
  placement: MemorySheetPlacement;
};

type PinScreenPoint = { x: number; y: number };

const EDGE = 10;
const PIN_GAP = 12;
const PIN_HIT = 20;

function projectPin(
  map: MapLibreMap,
  mapContainer: HTMLElement,
  mapHost: HTMLElement,
  coordinates: [number, number],
  screenOffset?: [number, number],
): PinScreenPoint {
  const projected = map.project(coordinates);
  const mapRect = mapContainer.getBoundingClientRect();
  const hostRect = mapHost.getBoundingClientRect();
  return {
    x: projected.x + (mapRect.left - hostRect.left) + (screenOffset?.[0] ?? 0),
    y: projected.y + (mapRect.top - hostRect.top) + (screenOffset?.[1] ?? 0),
  };
}

function tooltipBox(
  x: number,
  y: number,
  placement: MemorySheetPlacement,
  width: number,
  height: number,
) {
  const half = width / 2;
  const top = placement === "top" ? y - PIN_GAP - height : y + PIN_GAP;
  return { left: x - half, right: x + half, top, bottom: top + height };
}

function overlapsPin(box: ReturnType<typeof tooltipBox>, pin: PinScreenPoint) {
  const closestX = Math.max(box.left, Math.min(pin.x, box.right));
  const closestY = Math.max(box.top, Math.min(pin.y, box.bottom));
  const dx = pin.x - closestX;
  const dy = pin.y - closestY;
  return dx * dx + dy * dy < PIN_HIT * PIN_HIT;
}

export function computeMemorySheetAnchor(input: {
  map: MapLibreMap;
  mapContainer: HTMLElement;
  mapHost: HTMLElement;
  coordinates: [number, number];
  screenOffset?: [number, number];
  sheetWidth: number;
  sheetHeight: number;
  otherPinPoints: PinScreenPoint[];
}): MemorySheetAnchor {
  const { map, mapContainer, mapHost, coordinates, screenOffset, sheetWidth, sheetHeight, otherPinPoints } = input;
  const hostRect = mapHost.getBoundingClientRect();
  const mapWidth = hostRect.width;
  const mapHeight = hostRect.height;
  const tip = projectPin(map, mapContainer, mapHost, coordinates, screenOffset);

  let placement: MemorySheetPlacement = "top";
  if (tip.y - PIN_GAP - sheetHeight < EDGE) placement = "bottom";
  if (placement === "bottom" && tip.y + PIN_GAP + sheetHeight > mapHeight - EDGE) placement = "top";

  const half = sheetWidth / 2;
  let x = tip.x;
  x = Math.max(half + EDGE, Math.min(mapWidth - half - EDGE, x));

  const shifts = [0, 28, -28, 44, -44];
  for (const shift of shifts) {
    const candidateX = Math.max(half + EDGE, Math.min(mapWidth - half - EDGE, tip.x + shift));
    const box = tooltipBox(candidateX, tip.y, placement, sheetWidth, sheetHeight);
    const blocked = otherPinPoints.some(pin => overlapsPin(box, pin));
    if (!blocked) {
      x = candidateX;
      break;
    }
  }

  return { x, y: tip.y, placement };
}

export function pinScreenPoints(
  map: MapLibreMap,
  mapContainer: HTMLElement,
  mapHost: HTMLElement,
  pins: ReadonlyArray<{ id: string; coordinates: [number, number] }>,
  screenOffsets: ReadonlyArray<[number, number] | undefined>,
  excludeId?: string,
): PinScreenPoint[] {
  return pins.flatMap((pin, index) => {
    if (pin.id === excludeId) return [];
    return [projectPin(map, mapContainer, mapHost, pin.coordinates, screenOffsets[index])];
  });
}
