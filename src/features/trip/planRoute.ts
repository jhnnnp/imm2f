export type LngLat = [number, number];

const METERS_PER_DEG_LAT = 110540;

function metersPerDegLng(lat: number) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export function metersBetween(a: LngLat, b: LngLat) {
  const lat = (a[1] + b[1]) / 2;
  const dx = (b[0] - a[0]) * metersPerDegLng(lat);
  const dy = (b[1] - a[1]) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

export function offsetPoint(point: LngLat, dxMeters: number, dyMeters: number): LngLat {
  return [point[0] + dxMeters / metersPerDegLng(point[1]), point[1] + dyMeters / METERS_PER_DEG_LAT];
}

export function densifyRoute(coordinates: LngLat[], steps = 10): LngLat[] {
  if (coordinates.length < 2) return coordinates.slice();
  const next: LngLat[] = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      next.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
    }
  }
  next.push(coordinates[coordinates.length - 1]);
  return next;
}

function catmullRom(p0: LngLat, p1: LngLat, p2: LngLat, p3: LngLat, t: number): LngLat {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

function bulgeSegment(start: LngLat, end: LngLat, samples = 14): LngLat[] {
  const length = metersBetween(start, end);
  if (length < 40) return densifyRoute([start, end], 6);
  const lat = (start[1] + end[1]) / 2;
  const dx = (end[0] - start[0]) * metersPerDegLng(lat);
  const dy = (end[1] - start[1]) * METERS_PER_DEG_LAT;
  const normalScale = Math.min(length * 0.14, 220) / (Math.hypot(dx, dy) || 1);
  const mid: LngLat = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const control = offsetPoint(mid, -dy * normalScale, dx * normalScale);
  const points: LngLat[] = [];
  for (let step = 0; step < samples; step += 1) {
    const t = step / samples;
    const u = 1 - t;
    points.push([
      u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
    ]);
  }
  points.push(end);
  return points;
}

export function curveRoute(coordinates: LngLat[], samplesPerSegment = 12): LngLat[] {
  if (coordinates.length < 2) return coordinates.slice();
  if (coordinates.length === 2) return bulgeSegment(coordinates[0], coordinates[1], Math.max(10, samplesPerSegment));
  const points: LngLat[] = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const p0 = coordinates[Math.max(0, index - 1)];
    const p1 = coordinates[index];
    const p2 = coordinates[index + 1];
    const p3 = coordinates[Math.min(coordinates.length - 1, index + 2)];
    for (let step = 0; step < samplesPerSegment; step += 1) {
      points.push(catmullRom(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }
  points.push(coordinates[coordinates.length - 1]);
  return points;
}

export function cinematicBearing(coordinates: LngLat[]) {
  if (coordinates.length < 2) return -22;
  const origin = coordinates[0];
  let farthest = coordinates[1];
  let best = 0;
  for (const point of coordinates.slice(1)) {
    const distance = metersBetween(origin, point);
    if (distance > best) {
      best = distance;
      farthest = point;
    }
  }
  const lat = (origin[1] + farthest[1]) / 2;
  const dx = (farthest[0] - origin[0]) * metersPerDegLng(lat);
  const dy = (farthest[1] - origin[1]) * METERS_PER_DEG_LAT;
  return (Math.atan2(dx, dy) * 180) / Math.PI + 90;
}

export function ribbonWidthMeters(coordinates: LngLat[]) {
  if (coordinates.length < 2) return 48;
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += metersBetween(coordinates[index], coordinates[index + 1]);
  }
  const average = total / (coordinates.length - 1);
  return Math.max(56, Math.min(220, average * 0.08));
}

export function routeRibbon(coordinates: LngLat[], widthMeters: number): { type: "Polygon"; coordinates: number[][][] } | null {
  const path = densifyRoute(coordinates, 4);
  if (path.length < 2) return null;
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  const half = widthMeters / 2;
  for (let index = 0; index < path.length; index += 1) {
    const prev = path[Math.max(0, index - 1)];
    const next = path[Math.min(path.length - 1, index + 1)];
    const [lng, lat] = path[index];
    const dx = (next[0] - prev[0]) * metersPerDegLng(lat);
    const dy = (next[1] - prev[1]) * METERS_PER_DEG_LAT;
    const length = Math.hypot(dx, dy) || 1;
    const offsetX = (-dy / length) * half;
    const offsetY = (dx / length) * half;
    left.push(offsetPoint([lng, lat], offsetX, offsetY));
    right.push(offsetPoint([lng, lat], -offsetX, -offsetY));
  }
  return { type: "Polygon", coordinates: [[...left, ...right.reverse(), left[0]]] };
}

export function routePlanks(coordinates: LngLat[], widthMeters: number) {
  const path = densifyRoute(coordinates, 3);
  if (path.length < 2) return [];
  const half = widthMeters / 2;
  const planks: Array<{ type: "Polygon"; coordinates: number[][][] }> = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const lat = (start[1] + end[1]) / 2;
    const dx = (end[0] - start[0]) * metersPerDegLng(lat);
    const dy = (end[1] - start[1]) * METERS_PER_DEG_LAT;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    const extendX = (dx / length) * Math.min(8, length * 0.15);
    const extendY = (dy / length) * Math.min(8, length * 0.15);
    const a = offsetPoint(start, -extendX, -extendY);
    const b = offsetPoint(end, extendX, extendY);
    const ring = [
      offsetPoint(a, nx, ny),
      offsetPoint(b, nx, ny),
      offsetPoint(b, -nx, -ny),
      offsetPoint(a, -nx, -ny),
    ];
    ring.push(ring[0]);
    planks.push({ type: "Polygon", coordinates: [ring] });
  }
  return planks;
}

export function stopDisc(center: LngLat, radiusMeters: number, sides = 20): { type: "Polygon"; coordinates: number[][][] } {
  const ring: LngLat[] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2;
    ring.push(offsetPoint(center, Math.cos(angle) * radiusMeters, Math.sin(angle) * radiusMeters));
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

type RouteFeature = {
  type: "Feature";
  properties: { height?: number; base?: number };
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "LineString"; coordinates: LngLat[] } | { type: "Point"; coordinates: LngLat };
};

function collection(features: RouteFeature[]) {
  return { type: "FeatureCollection" as const, features };
}

export function hopBox(start: LngLat, end: LngLat, widthMeters: number): { type: "Polygon"; coordinates: number[][][] } {
  const lat = (start[1] + end[1]) / 2;
  const dx = (end[0] - start[0]) * metersPerDegLng(lat);
  const dy = (end[1] - start[1]) * METERS_PER_DEG_LAT;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (widthMeters / 2);
  const ny = (dx / length) * (widthMeters / 2);
  const ring = [
    offsetPoint(start, nx, ny),
    offsetPoint(end, nx, ny),
    offsetPoint(end, -nx, -ny),
    offsetPoint(start, -nx, -ny),
  ];
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length];
    area += ring[index][0] * next[1] - next[0] * ring[index][1];
  }
  if (area < 0) ring.reverse();
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

function extruded(geometry: { type: "Polygon"; coordinates: number[][][] }, height: number, base = 0): RouteFeature {
  return { type: "Feature", properties: { height, base }, geometry };
}

export function buildPlanRoute(coordinates: LngLat[]) {
  const empty = collection([]);
  if (coordinates.length < 2) {
    return {
      line: empty,
      aura: empty,
      body: empty,
      core: empty,
      stops: coordinates.length === 1 ? collection([extruded(stopDisc(coordinates[0], 18), 240)]) : empty,
      nodes: coordinates.length === 1
        ? collection([{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coordinates[0] } }])
        : empty,
    };
  }
  const path = curveRoute(coordinates);
  const width = ribbonWidthMeters(coordinates);
  return {
    line: collection([{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: path },
    }]),
    aura: collection(coordinates.slice(0, -1).map((point, index) => extruded(hopBox(point, coordinates[index + 1], width * 2.4), 820))),
    body: collection(coordinates.slice(0, -1).map((point, index) => extruded(hopBox(point, coordinates[index + 1], width), 980))),
    core: collection(coordinates.slice(0, -1).map((point, index) => extruded(hopBox(point, coordinates[index + 1], width * 0.42), 1100, 420))),
    stops: collection(coordinates.map(point => extruded(stopDisc(point, Math.max(22, width * 0.28)), 520))),
    nodes: collection(coordinates.map(point => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Point" as const, coordinates: point },
    }))),
  };
}
