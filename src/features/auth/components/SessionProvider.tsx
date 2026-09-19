"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAppSession } from "../session";
import type { AppSession } from "../types";

const SessionContext = createContext<AppSession>({ mode: "guest" });
const CACHE_KEY = "only-us:shell-session";

function readCachedSession(): AppSession | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppSession;
    if (parsed.mode === "authenticated" && parsed.userId && parsed.coupleId) return parsed;
    if (parsed.mode === "setup_error" && parsed.userId) return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeCachedSession(session: AppSession) {
  try {
    if (session.mode === "guest") sessionStorage.removeItem(CACHE_KEY);
    else sessionStorage.setItem(CACHE_KEY, JSON.stringify(session));
  } catch {
    // Private mode and quota errors should not break the shell.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AppSession>({ mode: "guest" });

  useLayoutEffect(() => {
    const cached = readCachedSession();
    if (cached) setSession(cached);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: AppSession) => {
      if (cancelled) return;
      setSession(next);
      writeCachedSession(next);
    };
    let refreshing = false;
    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      void getAppSession().then(apply).catch(() => {
        if (!cancelled && !readCachedSession()) apply({ mode: "guest" });
      }).finally(() => { refreshing = false; });
    };
    refresh();
    const supabase = createClient();
    const subscription = supabase?.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") apply({ mode: "guest" });
      else if (event === "SIGNED_IN" || event === "USER_UPDATED") refresh();
    });
    return () => {
      cancelled = true;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useAppSession() {
  return useContext(SessionContext);
}
