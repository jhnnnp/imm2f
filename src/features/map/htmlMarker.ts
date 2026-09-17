export const htmlMarkerPlacement = {
  anchor: "bottom" as const,
  pitchAlignment: "viewport" as const,
  rotationAlignment: "viewport" as const,
  subpixelPositioning: true,
};

const SAME_POINT = 1e-5;

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
