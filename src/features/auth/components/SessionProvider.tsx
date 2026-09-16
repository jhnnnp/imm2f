"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { AppSession } from "../types";
import { getAppSession } from "../session";

const SessionContext = createContext<AppSession>({ mode: "prototype" });

export function SessionProvider({ initialSession, children }: { initialSession: AppSession; children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState(initialSession);

  useEffect(() => {
    let active = true;
    void getAppSession().then(nextSession => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useAppSession() {
  return useContext(SessionContext);
}
