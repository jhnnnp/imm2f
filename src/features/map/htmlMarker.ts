export const htmlMarkerPlacement = {
  anchor: "bottom" as const,
  // The pin tip stays at its geographic coordinate. MapLibre already updates
  // projection on move/zoom/rotate; application collision offsets move venues.
  offset: [0, 0] as [number, number],
  pitchAlignment: "viewport" as const,
  rotationAlignment: "viewport" as const,
  subpixelPositioning: true,
};
