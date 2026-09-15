const EARTH_METERS = 6371000;

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(from: [number, number], to: [number, number]) {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function clampRadius(meters: number) {
  return Math.min(20000, Math.max(300, Math.round(meters)));
}
