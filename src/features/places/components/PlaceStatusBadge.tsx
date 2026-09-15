import { STATUS_META } from "../config/statusMeta";
import type { PlacePreferenceStatus } from "../types/place";

export function PlaceStatusBadge({ status }: { status: PlacePreferenceStatus }) {
  const meta = STATUS_META[status];
  return <span className={`status-badge status-${status}`}>{meta.icon} {meta.label}</span>;
}
