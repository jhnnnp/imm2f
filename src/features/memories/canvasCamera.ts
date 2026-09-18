export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };

export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const GRID_SIZE = 32;
export const MIN_ZOOM = 0.18;
export const MAX_ZOOM = 3.4;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function screenToWorld(camera: Camera, point: Point): Point {
  const zoom = camera.zoom || 1;
  return {
    x: (point.x - camera.x) / zoom,
    y: (point.y - camera.y) / zoom,
  };
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

export function zoomAt(camera: Camera, screen: Point, factor: number): Camera {
  const zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const world = screenToWorld(camera, screen);
  return {
    zoom,
    x: screen.x - world.x * zoom,
    y: screen.y - world.y * zoom,
  };
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

export function fitCamera(view: { width: number; height: number }, padding = 36): Camera {
  return fitRect(view, { x: 0, y: 0, width: WORLD_W, height: WORLD_H }, padding);
}

export function fitRect(
  view: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
  padding = 48,
): Camera {
  const width = Math.max(1, view.width);
  const height = Math.max(1, view.height);
  const zoom = clamp(
    Math.min((width - padding * 2) / Math.max(1, rect.width), (height - padding * 2) / Math.max(1, rect.height)),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    zoom,
    x: width / 2 - centerX * zoom,
    y: height / 2 - centerY * zoom,
  };
}

export function contentRect(points: Array<{ x: number; y: number }>, piece = { width: 280, height: 340 }) {
  if (!points.length) return { x: 80, y: 80, width: 1100, height: 760 };
  const minX = Math.min(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxX = Math.max(...points.map(point => point.x + piece.width));
  const maxY = Math.max(...points.map(point => point.y + piece.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(420, maxX - minX),
    height: Math.max(360, maxY - minY),
  };
}

export function viewportPoint(bounds: DOMRect, clientX: number, clientY: number): Point {
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

export function gridFill(camera: Camera, size = GRID_SIZE) {
  const cell = size * (camera.zoom || 1);
  return {
    backgroundSize: `${cell}px ${cell}px`,
    backgroundPosition: `${camera.x}px ${camera.y}px`,
  };
}
