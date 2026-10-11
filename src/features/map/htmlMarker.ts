export const htmlMarkerPlacement = {
  anchor: "bottom" as const,
  pitchAlignment: "viewport" as const,
  rotationAlignment: "viewport" as const,
  subpixelPositioning: true,
};

const SAME_POINT = 1e-5;

const PIN_SEPARATION = 52;
const COLUMN_SPACING = 56;
const ROW_SPACING = 60;
const nearbyCenters = Array.from({ length: 25 }, (_, row) => row - 12)
  .flatMap(y => Array.from({ length: 25 }, (_, column) => ({ x: column - 12, y })))
  .sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || Math.abs(a.y) - Math.abs(b.y));

/** Spread visible marker tips in screen space; separated and off-screen pins stay put. */
export function screenOffsetsForNearbyPins(
  points: ReadonlyArray<{ x: number; y: number }>,
  viewport?: { width: number; height: number },
): [number, number][] {
  const offsets: [number, number][] = points.map(() => [0, 0]);
  const bounds = viewport && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
    && viewport.width > 0 && viewport.height > 0 ? viewport : undefined;
  const visible = points.map(point => Number.isFinite(point.x) && Number.isFinite(point.y)
    && (!bounds || (point.x >= 0 && point.x <= bounds.width && point.y >= 0 && point.y <= bounds.height)));
  const parents = points.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  for (let index = 0; index < points.length; index += 1) {
    if (!visible[index]) continue;
    for (let other = index + 1; other < points.length; other += 1) {
      if (visible[other] && Math.hypot(points[index].x - points[other].x, points[index].y - points[other].y) < PIN_SEPARATION) {
        parents[root(other)] = root(index);
      }
    }
  }
  const groups = new Map<number, number[]>();
  points.forEach((_, index) => { const key = root(index); groups.set(key, [...(groups.get(key) ?? []), index]); });
  const placed = points.map(point => ({ ...point }));
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const center = members.reduce((sum, index) => ({ x: sum.x + points[index].x / members.length, y: sum.y + points[index].y / members.length }), { x: 0, y: 0 });
    const verticalPair = members.length === 2
      && Math.abs(points[members[0]].y - points[members[1]].y) > Math.abs(points[members[0]].x - points[members[1]].x);
    const columns = verticalPair ? 1 : Math.max(1, Math.min(
      Math.ceil(Math.sqrt(members.length)),
      bounds ? Math.max(1, Math.floor((bounds.width - 56) / COLUMN_SPACING) + 1) : members.length,
    ));
    const rows = Math.ceil(members.length / columns);
    const layout = members.map((_, index) => {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, members.length - row * columns);
      return { x: (index % columns - (rowCount - 1) / 2) * COLUMN_SPACING, y: (row - (rows - 1) / 2) * ROW_SPACING };
    });
    const memberSet = new Set(members);
    const obstacles = placed.filter((_, index) => !memberSet.has(index) && visible[index]);
    const minX = Math.min(...layout.map(point => point.x));
    const maxX = Math.max(...layout.map(point => point.x));
    const minY = Math.min(...layout.map(point => point.y));
    const maxY = Math.max(...layout.map(point => point.y));
    const clampCenter = (value: number, low: number, high: number) => low <= high ? Math.max(low, Math.min(high, value)) : (low + high) / 2;
    const keepInBounds = (candidate: { x: number; y: number }) => bounds ? {
      x: clampCenter(candidate.x, 28 - minX, bounds.width - 28 - maxX),
      y: clampCenter(candidate.y, 58 - minY, bounds.height - 12 - maxY),
    } : candidate;
    let nextCenter = keepInBounds(center);
    for (const candidate of nearbyCenters) {
      const next = keepInBounds({ x: center.x + candidate.x * 14, y: center.y + candidate.y * 15 });
      if (layout.every(point => obstacles.every(obstacle => Math.hypot(next.x + point.x - obstacle.x, next.y + point.y - obstacle.y) >= PIN_SEPARATION))) {
        nextCenter = next;
        break;
      }
    }
    members.forEach((index, order) => {
      const point = { x: nextCenter.x + layout[order].x, y: nextCenter.y + layout[order].y };
      offsets[index] = [Number((point.x - points[index].x).toFixed(2)), Number((point.y - points[index].y).toFixed(2))];
      placed[index] = point;
    });
  }
  return offsets;
}

export function screenOffsetForStackedPins(
  coordinates: ReadonlyArray<readonly [number, number]>,
  index: number,
): [number, number] | undefined {
  const point = coordinates[index];
  if (!point) return undefined;
  const stacked = coordinates
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(({ candidate }) => Math.abs(candidate[0] - point[0]) < SAME_POINT && Math.abs(candidate[1] - point[1]) < SAME_POINT);
  if (stacked.length < 2) return undefined;
  const order = stacked.findIndex(item => item.candidateIndex === index);
  const angle = (order / stacked.length) * Math.PI * 2 - Math.PI / 2;
  return [Math.round(Math.cos(angle) * 12), Math.round(Math.sin(angle) * 10)];
}
