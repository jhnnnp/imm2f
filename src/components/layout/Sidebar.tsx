"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppLink } from "./AppLink";
import { NAVIGATION } from "./navigation";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { signOut } from "@/features/auth/session";
import { initialFromName } from "@/features/auth/types";
import { pairLabel } from "@/features/auth/koreanName";
import { BrandMark, SidebarIcon } from "./SidebarIcon";

export function Sidebar() {
  const pathname = usePathname();
  const session = useAppSession();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [menuOpen]);
  const hasIdentity = session.mode === "authenticated" || session.mode === "setup_error";
  const youName = hasIdentity ? session.displayName : "나";
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName ?? null : null;
  const youInitial = initialFromName(youName);
  const partnerInitial = partnerName ? initialFromName(partnerName) : "?";

  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <AppLink className="brand" href="/" prefetchMode="hover" aria-label="홈으로 이동">
        <span className="brand-mark"><BrandMark /></span>
        <span className="brand-copy"><strong>ONLY US</strong><small>PRIVATE SPACE FOR TWO</small></span>
      </AppLink>
      <nav className="nav-list" aria-label="전체 메뉴">
        {NAVIGATION.map((item, index) => {
          if ("section" in item) return <p key={`${item.section}-${index}`}>{item.section}</p>;
          const active = ready && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
          return (
            <AppLink className={`nav-item ${active ? "is-active" : ""}`} href={item.href} prefetchMode="hover" key={item.href} suppressHydrationWarning>
              <span className="nav-icon-wrap"><SidebarIcon name={item.iconName} /></span>{item.label}
            </AppLink>
          );
        })}
      </nav>
      <nav className="mobile-bottom-nav" aria-label="빠른 메뉴">
        {NAVIGATION.filter((item): item is Extract<(typeof NAVIGATION)[number], { href: string }> => "href" in item && ["/", "/date", "/trip", "/places"].includes(item.href)).map(item => (
          <AppLink className={`mobile-nav-item ${pathname === item.href ? "is-active" : ""}`} href={item.href} key={item.href}>
            <SidebarIcon name={item.iconName} /><span>{item.label}</span>
          </AppLink>
        ))}
        <button className={`mobile-nav-item ${menuOpen || !["/", "/date", "/trip", "/places"].includes(pathname) ? "is-active" : ""}`} type="button" aria-expanded={menuOpen} aria-controls="mobile-all-menu" onClick={() => setMenuOpen(value => !value)}>
          <span className="mobile-menu-glyph" aria-hidden="true">☷</span><span>전체</span>
        </button>
      </nav>
      {menuOpen && <div className="mobile-menu-layer">
        <button className="mobile-menu-scrim" type="button" aria-label="전체 메뉴 닫기" onClick={() => setMenuOpen(false)} />
        <div className="mobile-menu-sheet" id="mobile-all-menu" role="dialog" aria-label="전체 메뉴">
          <div className="mobile-menu-head"><strong>전체 메뉴</strong><button type="button" onClick={() => setMenuOpen(false)} aria-label="닫기">×</button></div>
          <div className="mobile-menu-grid">
            {NAVIGATION.filter((item): item is Extract<(typeof NAVIGATION)[number], { href: string }> => "href" in item).map(item => <AppLink href={item.href} key={item.href} className={pathname === item.href ? "is-active" : ""} onClick={() => setMenuOpen(false)}>
              <SidebarIcon name={item.iconName} /><span>{item.label}</span>
            </AppLink>)}
          </div>
        </div>
      </div>}
      <div className={`couple-card is-${session.mode} ${partnerName ? "has-partner" : ""}`}>
        <div className="couple-card-main">
          <div className="paired-avatars" aria-hidden="true"><span className="avatar you">{youInitial}</span><span className="avatar partner">{partnerInitial}</span></div>
          <div className="couple-card-copy">
            <strong>{session.mode === "setup_error" ? `${youName} · 복구 필요` : pairLabel(youName, partnerName)}</strong>
            <small>
              {session.mode === "authenticated"
                ? session.partner ? "우리의 공간이 연결되어 있어요" : "함께할 파트너를 초대해 보세요"
                : session.mode === "setup_error" ? "로그인은 됐지만 공간을 준비하지 못했어요"
                  : "로그인하고 우리의 공간을 시작해요"}
            </small>
          </div>
        </div>
        {session.mode === "authenticated" && session.partner
          ? <AppLink className="couple-card-action" href="/invite" prefetchMode="hover">
            <span>파트너 관리</span><b aria-hidden="true">→</b>
          </AppLink>
          : session.mode === "setup_error"
            ? <button className="couple-card-action" type="button" onClick={() => void signOut()}>
              <span>다시 로그인</span><b aria-hidden="true">→</b>
            </button>
            : <AppLink className="couple-card-action" prefetchMode="hover" href={session.mode === "authenticated" ? "/invite" : "/login"}>
              <span>{session.mode === "authenticated" ? "파트너 초대" : "로그인"}</span><b aria-hidden="true">→</b>
            </AppLink>}
      </div>
    </aside>
  );
}
