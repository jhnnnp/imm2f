import type { CorkBoardState } from "./corkLayout";
import { parseStoredWallBoard, validWallBoard } from "./boardValidation";

type WallDraft = { base: CorkBoardState; state: CorkBoardState };

function draftKey(coupleId: string, userId: string | null) {
  return `only-us:cork-wall:pending:v1:${coupleId}:${userId ?? "guest"}`;
}

/** Keep the last acknowledged base with unsaved edits, so returning to the wall can merge them. */
export function readWallDraft(coupleId: string, userId: string | null): WallDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(coupleId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { base?: unknown; state?: unknown };
    if (!parsed || typeof parsed !== "object" || !parsed.base || !parsed.state) return null;
    const base = parseStoredWallBoard(parsed.base);
    const state = parseStoredWallBoard(parsed.state);
    return validWallBoard(base) && validWallBoard(state) ? { base, state } : null;
  } catch {
    return null;
  }
}

export function writeWallDraft(coupleId: string, userId: string | null, base: CorkBoardState, state: CorkBoardState) {
  try {
    localStorage.setItem(draftKey(coupleId, userId), JSON.stringify({ base, state }));
  } catch {
    // A full or unavailable browser store must not interrupt editing or server saving.
  }
}

export function clearWallDraft(coupleId: string, userId: string | null) {
  try {
    localStorage.removeItem(draftKey(coupleId, userId));
  } catch {
    // The acknowledged server board is still the source of truth.
  }
}
