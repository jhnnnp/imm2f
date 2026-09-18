"use client";

import { createClient } from "@/lib/supabase/client";
import { parseBoardState, type CorkBoardState } from "./corkLayout";

export function subscribeMemoryWallBoard(
  coupleId: string,
  onRemote: (state: CorkBoardState, updatedAt: string, updatedBy: string | null) => void,
) {
  const supabase = createClient();
  if (!supabase) return { unsubscribe: () => {}, connected: Promise.resolve(false) };

  let subscribed = false;
  const channel = supabase
    .channel(`memory-wall-board:${coupleId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "memory_wall_boards", filter: `couple_id=eq.${coupleId}` },
      payload => {
        const row = payload.new as { state?: unknown; updated_at?: string; updated_by?: string | null } | null;
        if (!row?.state) return;
        const raw = typeof row.state === "string" ? row.state : JSON.stringify(row.state);
        const parsed = parseBoardState(raw);
        if (!parsed) return;
        onRemote(parsed, row.updated_at ?? new Date().toISOString(), row.updated_by ?? null);
      },
    )
    .subscribe(status => {
      subscribed = status === "SUBSCRIBED";
    });

  return {
    unsubscribe() {
      void supabase.removeChannel(channel);
    },
    connected: new Promise<boolean>(resolve => {
      window.setTimeout(() => resolve(subscribed), 1200);
    }),
  };
}
