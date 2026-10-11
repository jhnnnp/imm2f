/** Compare timestamps without dropping PostgreSQL changes within one millisecond. */
export function isNewerBoardVersion(candidate: string, current: string | null) {
  const nextMs = Date.parse(candidate);
  if (!Number.isFinite(nextMs)) return false;
  if (!current) return true;
  const currentMs = Date.parse(current);
  if (!Number.isFinite(currentMs)) return true;
  if (nextMs !== currentMs) return nextMs > currentMs;
  const fraction = (iso: string) => (iso.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  return fraction(candidate) > fraction(current);
}
