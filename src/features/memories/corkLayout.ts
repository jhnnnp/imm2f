import { WORLD_H, WORLD_W, type Camera } from "./canvasCamera";
import { parseInkStrokes, type InkStroke } from "./inkStrokes";

export type CorkPose = { x: number; y: number; z: number; r: number };
export type CorkBoardState = {
  v: 3;
  camera: Camera | null;
  poses: Record<string, CorkPose>;
  strokes: InkStroke[];
};

export const CORK_DRAG_GAP = 7;
export const CORK_STORAGE_PREFIX = "only-us:cork-wall:v3:";
const LEGACY_STORAGE_PREFIX = "only-us:cork-wall:v2:";

const TILTS = [-6.4, 3.8, -2.2, 5.6, -4.8, 2.4, 7.1, -3.4, 1.6, -5.2];
const JITTERS = [-1.4, 2.1, -2.6, 1.3, 2.8, -1.8, 0.6, -2.2];

export function corkStorageKey(coupleId: string) {
  return `${CORK_STORAGE_PREFIX}${coupleId}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRotation(degrees: number) {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
  return Math.round(wrapped * 10) / 10;
}

export function corkColumnCount(total: number) {
  if (total <= 1) return 1;
  if (total <= 4) return 2;
  if (total <= 9) return 3;
  return 4;
}

export function defaultCorkPose(index: number, total = 8): CorkPose {
  const cols = corkColumnCount(total);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 140 + col * 360 + JITTERS[index % JITTERS.length] * 14,
    y: 160 + row * 400 + JITTERS[(index + 3) % JITTERS.length] * 14,
    z: 2 + index,
    r: TILTS[index % TILTS.length],
  };
}

export function parseCorkPoses(raw: string | null): Record<string, CorkPose> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    if (parsed.v === 3 && parsed.poses && typeof parsed.poses === "object") {
      return parsePoseMap(parsed.poses as Record<string, unknown>);
    }
    return parsePoseMap(parsed);
  } catch {
    return {};
  }
}

function parsePoseMap(parsed: Record<string, unknown>): Record<string, CorkPose> {
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([id, value]) => [id, poseFromUnknown(value)])
      .filter((entry): entry is [string, CorkPose] => Boolean(entry[1])),
  );
}

export function poseFromUnknown(value: unknown, fallback?: CorkPose): CorkPose | null {
  if (!value || typeof value !== "object") return fallback ?? null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const z = Number(record.z);
  const r = Number(record.r);
  if (![x, y].every(Number.isFinite)) return fallback ?? null;
  return {
    x,
    y,
    z: Number.isFinite(z) ? z : fallback?.z ?? 2,
    r: Number.isFinite(r) ? normalizeRotation(r) : fallback?.r ?? 0,
  };
}

function migrateLegacyPoses(poses: Record<string, CorkPose>) {
  return Object.fromEntries(Object.entries(poses).map(([id, pose]) => [
    id,
    pose.x <= 100 && pose.y <= 100
      ? { ...pose, x: (pose.x / 100) * WORLD_W, y: (pose.y / 100) * WORLD_H }
      : pose,
  ]));
}

export function emptyBoardState(): CorkBoardState {
  return { v: 3, camera: null, poses: {}, strokes: [] };
}

export function parseBoardState(raw: string | null): CorkBoardState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v === 3) {
      return {
        v: 3,
        camera: cameraFromUnknown(parsed.camera),
        poses: parsePoseMap((parsed.poses as Record<string, unknown>) ?? {}),
        strokes: parseInkStrokes(parsed.strokes),
      };
    }
    return {
      v: 3,
      camera: null,
      poses: migrateLegacyPoses(parsePoseMap(parsed)),
      strokes: [],
    };
  } catch {
    return null;
  }
}

function cameraFromUnknown(value: unknown): Camera | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const zoom = Number(record.zoom);
  if (![x, y, zoom].every(Number.isFinite)) return null;
  return { x, y, zoom };
}

export function readBoardState(coupleId: string): CorkBoardState {
  try {
    const current = parseBoardState(localStorage.getItem(corkStorageKey(coupleId)));
    if (current) return current;
    const legacy = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${coupleId}`);
    const migrated = parseBoardState(legacy);
    return migrated ?? emptyBoardState();
  } catch {
    return emptyBoardState();
  }
}

export function writeBoardState(coupleId: string, state: CorkBoardState) {
  try {
    localStorage.setItem(corkStorageKey(coupleId), JSON.stringify(state));
  } catch {
    return;
  }
}

export function readCorkPoses(coupleId: string): Record<string, CorkPose> {
  return readBoardState(coupleId).poses;
}

export function writeCorkPoses(coupleId: string, poses: Record<string, CorkPose>) {
  const current = readBoardState(coupleId);
  writeBoardState(coupleId, { ...current, poses });
}

export function scatterCorkPoses(ids: string[], rng = Math.random): Record<string, CorkPose> {
  return Object.fromEntries(ids.map((id, index) => {
    const base = defaultCorkPose(index, ids.length);
    return [id, {
      x: clamp(base.x + (rng() - 0.5) * 80, 40, WORLD_W - 360),
      y: clamp(base.y + (rng() - 0.5) * 80, 40, WORLD_H - 360),
      z: base.z,
      r: normalizeRotation(base.r + (rng() - 0.5) * 10),
    }];
  }));
}

export function draggedPose(origin: CorkPose, dx: number, dy: number, zoom = 1): CorkPose {
  const scale = zoom || 1;
  return {
    ...origin,
    x: origin.x + dx / scale,
    y: origin.y + dy / scale,
  };
}

export function pointerAngle(cx: number, cy: number, x: number, y: number) {
  return Math.atan2(y - cy, x - cx) * (180 / Math.PI);
}

export function rotatedPose(origin: CorkPose, startAngle: number, currentAngle: number, snap = false) {
  const next = origin.r + (currentAngle - startAngle);
  const r = snap ? Math.round(next / 15) * 15 : next;
  return { ...origin, r: normalizeRotation(r) };
}
