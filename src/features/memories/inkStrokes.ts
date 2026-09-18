import { getStroke } from "perfect-freehand";

export type InkTool = "pen" | "marker";

export type InkPoint = [number, number, number];

export type InkStroke = {
  id: string;
  tool: InkTool;
  color: string;
  size: number;
  points: InkPoint[];
  path: string;
};

export const INK_COLORS = [
  { id: "ink", color: "#2b312e", label: "먹" },
  { id: "graphite", color: "#6a716c", label: "흑연" },
  { id: "navy", color: "#3f5368", label: "네이비" },
  { id: "sky", color: "#6a8ca8", label: "하늘" },
  { id: "sage", color: "#536f63", label: "세이지" },
  { id: "moss", color: "#7d9a6e", label: "모스" },
  { id: "wine", color: "#8c4b52", label: "와인" },
  { id: "rose", color: "#b77c77", label: "로즈" },
  { id: "coral", color: "#c57b62", label: "코랄" },
  { id: "brown", color: "#a9886d", label: "브라운" },
  { id: "amber", color: "#c4a15a", label: "앰버" },
  { id: "cream", color: "#e6d5b0", label: "크림" },
] as const;

export const PEN_SIZES = [7, 14, 22] as const;
export const MARKER_SIZES = [18, 28, 40] as const;

export function getSvgPathFromStroke(stroke: number[][]) {
  if (!stroke.length) return "";
  const max = stroke.length - 1;
  const parts = ["M", stroke[0][0].toFixed(2), stroke[0][1].toFixed(2), "Q"];
  for (let index = 1; index < stroke.length; index += 1) {
    const [x0, y0] = stroke[index];
    const [x1, y1] = stroke[index === max ? 0 : index + 1];
    parts.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
  }
  parts.push("Z");
  return parts.join(" ");
}

export function outlineStroke(points: InkPoint[], size: number, simulatePressure = true) {
  if (points.length === 1) {
    const [x, y, pressure] = points[0];
    const nudge = Math.max(1.6, size * 0.18);
    points = [
      [x, y, pressure],
      [x + nudge * 0.35, y + nudge * 0.08, pressure],
      [x + nudge, y + nudge * 0.16, pressure],
    ];
  }
  return getStroke(points, {
    size,
    thinning: simulatePressure ? 0.58 : 0.32,
    smoothing: 0.48,
    streamline: 0.42,
    easing: t => t,
    start: { taper: 0, cap: true },
    end: { taper: 12, cap: true },
    simulatePressure,
  });
}

export function strokePath(points: InkPoint[], size: number, simulatePressure = true) {
  return getSvgPathFromStroke(outlineStroke(points, size, simulatePressure));
}

export function createInkStroke(input: {
  tool: InkTool;
  color: string;
  size: number;
  points: InkPoint[];
  simulatePressure?: boolean;
}): InkStroke {
  return {
    id: crypto.randomUUID(),
    tool: input.tool,
    color: input.color,
    size: input.size,
    points: input.points,
    path: strokePath(input.points, input.size, input.simulatePressure ?? true),
  };
}

export function strokeHits(stroke: InkStroke, x: number, y: number, radius: number) {
  const reach = radius + stroke.size * 0.55;
  const reach2 = reach * reach;
  return stroke.points.some(([px, py]) => {
    const dx = px - x;
    const dy = py - y;
    return dx * dx + dy * dy <= reach2;
  });
}

export function eraseStrokes(strokes: InkStroke[], x: number, y: number, radius: number) {
  return strokes.filter(stroke => !strokeHits(stroke, x, y, radius));
}

export function parseInkStrokes(value: unknown): InkStroke[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const points = Array.isArray(record.points)
      ? record.points.filter((point): point is InkPoint => (
        Array.isArray(point) && point.length >= 2 && point.every(part => Number.isFinite(Number(part)))
      )).map(point => [Number(point[0]), Number(point[1]), Number(point[2] ?? 0.5)] as InkPoint)
      : [];
    if (!points.length) return [];
    const tool: InkTool = record.tool === "marker" ? "marker" : "pen";
    const size = Number(record.size);
    const color = String(record.color || "#2b312e");
    return [{
      id: String(record.id || crypto.randomUUID()),
      tool,
      color,
      size: Number.isFinite(size) ? size : 14,
      points,
      path: typeof record.path === "string" && record.path ? record.path : strokePath(points, Number.isFinite(size) ? size : 14),
    }];
  });
}
