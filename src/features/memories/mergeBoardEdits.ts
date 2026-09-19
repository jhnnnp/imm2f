import type { CorkBoardState } from "./corkLayout";

/** Apply only local changes since base, preserving unrelated remote edits and deletions. */
export function mergeBoardEdits(base: CorkBoardState, local: CorkBoardState, remote: CorkBoardState): CorkBoardState {
  function merge<T>(before: Record<string, T>, next: Record<string, T>, latest: Record<string, T>) {
    const result = { ...latest };
    for (const id of new Set([...Object.keys(before), ...Object.keys(next)])) {
      if (JSON.stringify(before[id]) === JSON.stringify(next[id])) continue;
      if (!(id in next)) delete result[id];
      else result[id] = next[id];
    }
    return result;
  }
  function indexed<T extends { id: string }>(items: T[]) { return Object.fromEntries(items.map(item => [item.id, item])); }
  return {
    v: 4,
    camera: local.camera,
    poses: merge(base.poses, local.poses, remote.poses),
    strokes: Object.values(merge(indexed(base.strokes), indexed(local.strokes), indexed(remote.strokes))),
    texts: Object.values(merge(indexed(base.texts), indexed(local.texts), indexed(remote.texts))),
  };
}
