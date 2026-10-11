"use client";

import { subscribeWorkspaceChanges } from "@/features/collaboration/realtimeSync";
import { parseBoardState, type CorkBoardState } from "./corkLayout";

export function subscribeMemoryWallBoard(
  coupleId: string,
  onRemote: (state: CorkBoardState, updatedAt: string, updatedBy: string | null) => void,
  onRefresh?: () => void,
) {
  return subscribeWorkspaceChanges(coupleId, change => {
    if (change.source !== "database") {
      if (change.source !== "local") onRefresh?.();
      return;
    }
    if (change.table !== "memory_wall_boards") return;
    const row = change.row;
    if (!row.state || typeof row.updated_at !== "string") { onRefresh?.(); return; }
    const raw = typeof row.state === "string" ? row.state : JSON.stringify(row.state);
    const parsed = parseBoardState(raw);
    if (!parsed) { onRefresh?.(); return; }
    onRemote(parsed, row.updated_at, typeof row.updated_by === "string" ? row.updated_by : null);
  });
}
