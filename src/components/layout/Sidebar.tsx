"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION } from "./navigation";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { signOut } from "@/features/auth/session";
import { initialFromName } from "@/features/auth/types";
import { BrandMark, SidebarIcon } from "./SidebarIcon";

export function Sidebar() {
  const pathname = usePathname();
  const session = useAppSession();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const hasIdentity = session.mode === "authenticated" || session.mode === "setup_error";
  const youName = hasIdentity ? session.displayName : "나";
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName ?? null : null;
  const youInitial = initialFromName(youName);
  const partnerInitial = partnerName ? initialFromName(partnerName) : "?";

  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <Link className="brand" href="/" aria-label="홈으로 이동">
        <span className="brand-mark"><BrandMark /></span>
        <span className="brand-copy"><strong>ONLY US</strong><small>PRIVATE SPACE FOR TWO</small></span>
      </Link>
      <nav className="nav-list">
        {NAVIGATION.map((item, index) => {
          if ("section" in item) return <p key={`${item.section}-${index}`}>{item.section}</p>;
          const active = ready && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
          return (
            <Link className={`nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href} suppressHydrationWarning>
              <span className="nav-icon-wrap"><SidebarIcon name={item.iconName} /></span>{item.label}
            </Link>
          );
        })}
      </nav>
      <div className={`couple-card is-${session.mode} ${partnerName ? "has-partner" : ""}`}>
        <div className="couple-card-main">
          <div className="paired-avatars" aria-hidden="true"><span className="avatar you">{youInitial}</span><span className="avatar partner">{partnerInitial}</span></div>
          <div className="couple-card-copy">
            <strong>{session.mode === "setup_error" ? `${youName} · 복구 필요` : <>{youName} <span>&amp;</span> {partnerName ?? "파트너"}</>}</strong>
            <small>
              {session.mode === "authenticated"
                ? session.partner ? "우리의공간이 연결되어 있어요" : "함께할 파트너를 초대해 보세요"
                : session.mode === "setup_error" ? "로그인은 됐지만 공간을 준비하지 못했어요"
                  : "로그인하고 우리의 공간을 시작해요"}
            </small>
          </div>
        </div>
        {session.mode === "authenticated" && session.partner
          ? <span className="couple-card-status"><i />연결됨</span>
          : session.mode === "setup_error"
            ? <button className="couple-card-action" type="button" onClick={() => void signOut()}>
              <span>다시 로그인</span><b aria-hidden="true">→</b>
            </button>
            : <Link className="couple-card-action" href={session.mode === "authenticated" ? "/invite" : "/login"}>
              <span>{session.mode === "authenticated" ? "파트너 초대" : "로그인"}</span><b aria-hidden="true">→</b>
            </Link>}
      </div>
    </aside>
  );
}
