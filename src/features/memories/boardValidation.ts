import { emptyBoardState, parseBoardState, type CorkBoardState } from "./corkLayout";
import { MAX_ZOOM, MIN_ZOOM } from "./canvasCamera";

export const MAX_WALL_BOARD_BYTES = 2_000_000;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const number = (value: unknown, limit = 100_000): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !["__proto__", "constructor", "prototype"].includes(value);
const color = (value: unknown) => typeof value === "string" && /^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value);
const pose = (value: unknown) => object(value) && number(value.x) && number(value.y) && number(value.z) && number(value.r, 180);
const legacyPose = (value: unknown) => object(value) && number(value.x) && number(value.y)
  && (value.z === undefined || number(value.z)) && (value.r === undefined || number(value.r, 3600));

/** Reject invalid content instead of silently truncating a shared drawing. */
export function validWallBoard(value: unknown): value is CorkBoardState {
  if (!object(value) || value.v !== 4 || !object(value.poses) || !Array.isArray(value.strokes) || !Array.isArray(value.texts)) return false;
  if (value.camera !== null && (!object(value.camera) || !number(value.camera.x, 1_000_000) || !number(value.camera.y, 1_000_000)
    || !number(value.camera.zoom) || value.camera.zoom < MIN_ZOOM || value.camera.zoom > MAX_ZOOM)) return false;
  const entries = Object.entries(value.poses);
  if (entries.length > 5000 || !entries.every(([key, value]) => id(key) && pose(value)) || value.strokes.length > 3000 || value.texts.length > 1000) return false;
  const strokeIds = new Set<string>();
  if (!value.strokes.every(stroke => {
    if (!object(stroke) || !id(stroke.id) || strokeIds.has(stroke.id) || !["pen", "marker"].includes(String(stroke.tool))
      || !color(stroke.color) || !number(stroke.size, 100) || stroke.size <= 0 || !Array.isArray(stroke.points)
      || !stroke.points.length || stroke.points.length > 20_000 || typeof stroke.path !== "string"
      || !stroke.path.length || stroke.path.length > 500_000 || !/^[MmLlHhVvCcSsQqTtAaZzEe0-9,.+\s-]+$/.test(stroke.path)) return false;
    strokeIds.add(stroke.id);
    return stroke.points.every(point => Array.isArray(point) && point.length === 3
      && number(point[0]) && number(point[1]) && number(point[2], 1) && point[2] >= 0);
  })) return false;
  const textIds = new Set<string>();
  if (!value.texts.every(text => {
    if (!object(text) || !id(text.id) || textIds.has(text.id) || !number(text.x) || !number(text.y) || !number(text.z)
      || !number(text.rotation, 3600) || typeof text.text !== "string" || text.text.length > 280 || !color(text.color)
      || !["hand", "sans"].includes(String(text.fontFamily)) || !["normal", "bold"].includes(String(text.fontWeight))
      || !number(text.fontSize) || text.fontSize < 14 || text.fontSize > 64
      || (text.authorId !== undefined && (typeof text.authorId !== "string" || text.authorId.length > 128))) return false;
    textIds.add(text.id);
    return true;
  })) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_WALL_BOARD_BYTES; }
  catch { return false; }
}

/** Support actual legacy drawings, but not damaged data disguised as an empty wall. */
export function parseStoredWallBoard(value: unknown, allowInitialDefault = false): CorkBoardState | null {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!object(raw)) return null;
    if (allowInitialDefault && !Object.keys(raw).length) return emptyBoardState();
    if (raw.v === 4) return validWallBoard(raw) ? raw : null;
    if (raw.v !== undefined && raw.v !== 3) return null;
    const poses = raw.v === 3 ? raw.poses : raw;
    if (!object(poses) || (!raw.v && !Object.keys(poses).length) || !Object.entries(poses).every(([key, value]) => id(key) && legacyPose(value))) return null;
    const parsed = parseBoardState(JSON.stringify(raw));
    if (!parsed || !validWallBoard(parsed)) return null;
    if (raw.v === 3 && ((raw.strokes !== undefined && (!Array.isArray(raw.strokes) || raw.strokes.length !== parsed.strokes.length))
      || (raw.texts !== undefined && (!Array.isArray(raw.texts) || raw.texts.length !== parsed.texts.length)))) return null;
    return parsed;
  } catch { return null; }
}
