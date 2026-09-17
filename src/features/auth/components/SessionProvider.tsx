"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppSession } from "../types";

const SessionContext = createContext<AppSession>({ mode: "guest" });

export function SessionProvider({ initialSession, children }: { initialSession: AppSession; children: ReactNode }) {
  return <SessionContext.Provider value={initialSession}>{children}</SessionContext.Provider>;
}

export function useAppSession() {
  return useContext(SessionContext);
}
