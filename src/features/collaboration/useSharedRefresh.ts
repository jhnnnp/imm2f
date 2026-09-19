"use client";

import { useEffect, useRef } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createClient } from "@/lib/supabase/client";
import { COUPLE_ACTIVITIES_CHANGED } from "./activityClient";

/** One subscription per screen; polling also recovers a dropped realtime connection. */
export function useSharedRefresh(refresh: () => Promise<void>) {
  const session = useAppSession();
  const coupleId = session.mode === "authenticated" ? session.coupleId : "";
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!coupleId) return;
    let busy = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (busy || stopped || document.visibilityState !== "visible") return;
      busy = true;
      try { await callback.current(); } catch { /* Preserve the last loaded content on network failure. */ }
      finally { busy = false; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void run(), 250); };
    const client = createClient();
    const channel = client?.channel(`screen-sync:${coupleId}:${crypto.randomUUID()}`);
    for (const table of ["activities", "plans", "date_drafts", "places", "memories"]) {
      channel?.on("postgres_changes", { event: "*", schema: "public", table, filter: `couple_id=eq.${coupleId}` }, schedule);
    }
    channel?.subscribe();
    const poll = setInterval(() => void run(), 15000);
    window.addEventListener("focus", schedule);
    window.addEventListener(COUPLE_ACTIVITIES_CHANGED, schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      stopped = true; clearTimeout(timer); clearInterval(poll);
      window.removeEventListener("focus", schedule);
      window.removeEventListener(COUPLE_ACTIVITIES_CHANGED, schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (channel) void client?.removeChannel(channel);
    };
  }, [coupleId]);
}
