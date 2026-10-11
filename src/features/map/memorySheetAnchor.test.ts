// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { computeMemorySheetAnchor, pinScreenPoints } from "./memorySheetAnchor";

function surface(left: number, top: number, width: number, height: number) {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: left, y: top, width, height });
  return element;
}
it("anchors the detail sheet to actual projection including map/host layout origin", () => {
  const mapHost = surface(100, 80, 600, 500);
  const mapContainer = surface(102, 82, 596, 496);
  const map = { project: () => ({ x: 287.33, y: 240.81 }) } as unknown as MapLibreMap;
  expect(computeMemorySheetAnchor({ map, mapHost, mapContainer, coordinates: [127, 37], sheetWidth: 200, sheetHeight: 54, otherPinPoints: [] }))
    .toEqual({ x: 289.33, y: 242.81, placement: "top" });
});
it("moves only the sheet around nearby pins while pin points remain geographic", () => {
  const mapHost = surface(0, 0, 600, 500);
  const mapContainer = mapHost;
  const map = { project: (coordinate: [number, number]) => ({ x: (coordinate[0] - 127) * 10_000 + 300, y: 250 }) } as unknown as MapLibreMap;
  const pins = [{ id: "first", coordinates: [127, 37] as [number, number] }, { id: "second", coordinates: [127.001, 37] as [number, number] }];
  const points = pinScreenPoints(map, mapContainer, mapHost, pins);
  expect(points[0]).toEqual({ x: 300, y: 250 });
  expect(points[1].x).toBeCloseTo(310, 9);
  expect(points[1].y).toBe(250);
  const anchor = computeMemorySheetAnchor({ map, mapContainer, mapHost, coordinates: pins[0].coordinates, sheetWidth: 200, sheetHeight: 54, otherPinPoints: [{ x: 300, y: 210 }] });
  expect(anchor.y).toBe(250);
  expect(pinScreenPoints(map, mapContainer, mapHost, pins, "first")).toHaveLength(1);
});
it("updates the sheet position directly with camera projection changes", () => {
  const mapHost = surface(0, 0, 600, 500);
  let camera = { x: 223.97, y: 211.43 };
  const map = { project: () => camera } as unknown as MapLibreMap;
  const compute = () => computeMemorySheetAnchor({ map, mapContainer: mapHost, mapHost, coordinates: [127, 37], sheetWidth: 100, sheetHeight: 54, otherPinPoints: [] });
  expect(compute()).toMatchObject(camera);
  camera = { x: 321.21, y: 314.32 };
  expect(compute()).toMatchObject(camera);
});
