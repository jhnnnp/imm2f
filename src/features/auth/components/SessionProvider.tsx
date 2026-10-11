"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageLoading } from "@/components/layout/PageLoading";
import { subscribeWorkspaceChanges } from "@/features/collaboration/realtimeSync";
import { getAppSession } from "../session";
import { appSessionIdentity, type AppSession } from "../types";

const SessionContext = createContext<AppSession>({ mode: "guest" });

export function SessionProvider({ children, initialSession }: { children: ReactNode; initialSession: AppSession }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [verificationError, setVerificationError] = useState("");
  const current = useRef(initialSession);
  const revision = useRef(0);
  const requestRefresh = useRef(() => {});

  useEffect(() => {
    revision.current += 1;
    current.current = initialSession;
    setSession(initialSession);
    setVerificationError("");
  }, [initialSession]);

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = (next: AppSession) => {
      if (cancelled) return;
      const previous = current.current;
      current.current = next;
      setSession(next);
      setVerificationError("");
      if (next.mode === "guest") { router.replace("/login"); router.refresh(); }
      else if (appSessionIdentity(previous) !== appSessionIdentity(next) || (previous.mode === "authenticated" && next.mode === "authenticated" && previous.partner?.userId !== next.partner?.userId)) router.refresh();
    };
    const refresh = async () => {
      if (cancelled) return;
      if (refreshing) { pending = true; return; }
      refreshing = true;
      const requestRevision = revision.current;
      try {
        const next = await getAppSession();
        if (revision.current === requestRevision) apply(next);
      } catch {
        // A transient network error must not discard a server-verified session.
        if (!cancelled && revision.current === requestRevision) setVerificationError("로그인 정보를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
      } finally {
        refreshing = false;
        if (pending && !cancelled) { pending = false; schedule(); }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    };
    requestRefresh.current = schedule;

    const supabase = createClient();
    const subscription = supabase?.auth.onAuthStateChange((event, authSession) => {
      if (event === "SIGNED_OUT") {
        revision.current += 1;
        clearTimeout(timer);
        pending = false;
        apply({ mode: "guest" });
        return;
      }
      const currentUserId = current.current.mode === "guest" ? null : current.current.userId;
      if (authSession?.user.id && authSession.user.id !== currentUserId) {
        revision.current += 1;
        // Hide the previous account while verifying the new cookie. This is
        // account switching, so retain the current route until verification.
        current.current = { mode: "guest" };
        setSession({ mode: "guest" });
        schedule();
      } else if (event === "USER_UPDATED") schedule();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (requestRefresh.current === schedule) requestRefresh.current = () => {};
      subscription?.data.subscription.unsubscribe();
    };
  }, [router]);

  const coupleId = session.mode === "authenticated" ? session.coupleId : "";
  useEffect(() => {
    if (!coupleId) return;
    let lastVerified = Date.now();
    const live = subscribeWorkspaceChanges(coupleId, change => {
      if (change.source === "database") {
        if (change.table !== "activities" || typeof change.row.action !== "string" || !change.row.action.startsWith("PARTNER_")) return;
      } else if (change.source === "local") return;
      else if (change.source === "poll" && Date.now() - lastVerified < 120_000) return;
      lastVerified = Date.now();
      requestRefresh.current();
    });
    return () => live.unsubscribe();
  }, [coupleId]);

  // RSC children belong to the server's identity. Do not display an old
  // couple's local state while a changed account/space is being re-rendered.
  const currentIdentity = appSessionIdentity(session);
  const serverIdentity = appSessionIdentity(initialSession);
  return <SessionContext.Provider value={session}>{currentIdentity === serverIdentity ? children : verificationError ? (
    <section className="empty-soft" role="alert"><h1>계정을 확인하고 있어요</h1><p>{verificationError}</p><button className="primary-button" type="button" onClick={() => requestRefresh.current()}>다시 시도</button></section>
  ) : <PageLoading />}</SessionContext.Provider>;
}

export function useAppSession() {
  return useContext(SessionContext);
}
