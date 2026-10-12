import type { CorkBoardState } from "./corkLayout";

export type WallEdit = { before: CorkBoardState; after: CorkBoardState };

export function wallContentEqual(a: CorkBoardState, b: CorkBoardState) {
  return JSON.stringify([a.poses, a.strokes, a.texts]) === JSON.stringify([b.poses, b.strokes, b.texts]);
}

/** Undo only objects that still match our edit; a partner's later changes must remain. */
export function restoreWallEdit(current: CorkBoardState, from: CorkBoardState, to: CorkBoardState): CorkBoardState {
  function restore<T>(latest: Record<string, T>, previous: Record<string, T>, target: Record<string, T>) {
    const result = { ...latest };
    for (const id of new Set([...Object.keys(previous), ...Object.keys(target)])) {
      if (JSON.stringify(previous[id]) === JSON.stringify(target[id])) continue;
      if (JSON.stringify(latest[id]) !== JSON.stringify(previous[id])) continue;
      if (id in target) result[id] = target[id];
      else delete result[id];
    }
    return result;
  }
  function indexed<T extends { id: string }>(items: T[]) {
    return Object.fromEntries(items.map(item => [item.id, item]));
  }
  return {
    ...current,
    poses: restore(current.poses, from.poses, to.poses),
    strokes: Object.values(restore(indexed(current.strokes), indexed(from.strokes), indexed(to.strokes))),
    texts: Object.values(restore(indexed(current.texts), indexed(from.texts), indexed(to.texts))),
  };
}
