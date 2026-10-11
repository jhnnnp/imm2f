// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Evented, LngLat, Marker, type Map as MapLibreMap } from "maplibre-gl";
import Point from "@mapbox/point-geometry";
import { htmlMarkerPlacement } from "./htmlMarker";

/** Use the installed Marker projection/event implementation without a WebGL canvas. */
function mapHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  let scale = 20;
  let panX = 0;
  let panY = 0;
  let bearing = 0;
  let pitch = 0;
  const project = (coordinate: LngLat | [number, number]) => {
    const point = LngLat.convert(coordinate);
    const angle = bearing * Math.PI / 180;
    const x = (point.lng - 127) * scale;
    const y = (37 - point.lat) * scale;
    return new Point(300 + panX + x * Math.cos(angle) - y * Math.sin(angle),
      250 + panY + (x * Math.sin(angle) + y * Math.cos(angle)) * Math.cos(pitch * Math.PI / 180));
  };
  const events = new Evented();
  const map = Object.assign(events, {
    project,
    getCanvasContainer: () => container,
    loaded: () => true,
    isMoving: () => false,
    getBearing: () => bearing,
    getPitch: () => pitch,
    _ownerWindow: window,
    _camera: { transform: {
      width: 600, height: 500,
      getCoveringTilesDetailsProvider: () => ({ allowWorldCopies: () => false }),
      isLocationOccluded: () => false,
    } },
  }) as unknown as MapLibreMap;
  return {
    map,
    camera(next: { scale?: number; x?: number; y?: number; bearing?: number; pitch?: number }) {
      scale = next.scale ?? scale; panX = next.x ?? panX; panY = next.y ?? panY;
      bearing = next.bearing ?? bearing; pitch = next.pitch ?? pitch;
      events.fire("move");
      events.fire("moveend");
    },
  };
}

const live: Marker[] = [];
function pin(map: MapLibreMap, coordinates: [number, number]) {
  const button = document.createElement("button");
  button.className = "memory-city-marker";
  button.innerHTML = '<span class="memory-city-marker-art"></span>';
  const marker = new Marker({ element: button, ...htmlMarkerPlacement }).setLngLat(coordinates).addTo(map);
  live.push(marker);
  return marker;
}
function renderedPoint(marker: Marker) {
  const translation = marker.getElement().style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  if (!translation) throw new Error("Marker has no projected translation");
  return [Number(translation[1]), Number(translation[2])];
}
function expectAnchored(marker: Marker, map: MapLibreMap, coordinates: [number, number]) {
  const projected = map.project(coordinates);
  const rendered = renderedPoint(marker);
  expect(rendered[0]).toBeCloseTo(projected.x, 9);
  expect(rendered[1]).toBeCloseTo(projected.y, 9);
  expect(marker.getOffset()).toEqual(new Point(0, 0));
  expect(marker.getElement().style.transform).toContain("translate(-50%,-100%)");
}
afterEach(() => { live.splice(0).forEach(marker => marker.remove()); document.body.replaceChildren(); });

describe("geographic HTML marker anchoring", () => {
  it("anchors the tip to the actual coordinate with no application offset or pixel rounding", () => {
    const { map } = mapHarness();
    const coordinate: [number, number] = [127.01321, 37.01093];
    expectAnchored(pin(map, coordinate), map, coordinate);
  });
  it("keeps close and identical locations at their actual projections instead of a screen grid", () => {
    const { map } = mapHarness();
    const coordinates: [number, number][] = [[127, 37], [127.001, 37.001], [127, 37]];
    const markers = coordinates.map(coordinate => pin(map, coordinate));
    markers.forEach((marker, index) => expectAnchored(marker, map, coordinates[index]));
    expect(renderedPoint(markers[0])).toEqual(renderedPoint(markers[2]));
    expect(Math.abs(renderedPoint(markers[0])[0] - renderedPoint(markers[1])[0])).toBeLessThan(1);
  });
  it("tracks pan, zoom, rotation and pitch through MapLibre's native move events", () => {
    const harness = mapHarness();
    const coordinate: [number, number] = [127.071, 37.12];
    const marker = pin(harness.map, coordinate);
    for (const next of [
      { x: 140.3, y: -63.7 }, { scale: 178.23 }, { bearing: -32.7, pitch: 44 },
      { scale: 1200.65, x: -17.31, y: 45.87 }, { scale: 14.67, bearing: 0, pitch: 0 },
    ]) {
      harness.camera(next);
      expectAnchored(marker, harness.map, coordinate);
      expect(marker.getElement().style.transform).toContain("rotateX(0deg)");
      expect(marker.getElement().style.transform).toContain("rotateZ(0deg)");
    }
  });
  it("leaves offscreen pins offscreen instead of pulling their artwork inside map edges", () => {
    const harness = mapHarness();
    const coordinate: [number, number] = [127, 37];
    const marker = pin(harness.map, coordinate);
    harness.camera({ x: -900, y: -900 });
    expectAnchored(marker, harness.map, coordinate);
    expect(renderedPoint(marker)[0]).toBeLessThan(0);
  });
  it("focus and selection styling leave the marker's positioning transform and coordinate unchanged", () => {
    const { map } = mapHarness();
    const coordinate: [number, number] = [127, 37];
    const marker = pin(map, coordinate);
    const transform = marker.getElement().style.transform;
    marker.getElement().focus();
    marker.getElement().classList.add("is-selected", "has-map-preview");
    expect(marker.getElement().style.transform).toBe(transform);
    expectAnchored(marker, map, coordinate);
  });
  it("removes native movement subscriptions with the marker so stale pins no longer update", () => {
    const harness = mapHarness();
    const marker = pin(harness.map, [127, 37]);
    marker.remove();
    const transform = marker.getElement().style.transform;
    harness.camera({ x: 110 });
    expect(marker.getElement().isConnected).toBe(false);
    expect(marker.getElement().style.transform).toBe(transform);
  });
});
