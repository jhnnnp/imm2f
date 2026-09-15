"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAVIGATION } from "./navigation";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { initialFromName } from "@/features/auth/types";
import { listPlaces } from "@/features/places/actions";

export function Sidebar() {
  const pathname = usePathname();
  const session = useAppSession();
  const [placeCount, setPlaceCount] = useState<number | null>(null);
  const youName = session.mode === "authenticated" ? session.displayName : "나";
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName ?? null : null;
  const youInitial = initialFromName(youName);
  const partnerInitial = partnerName ? initialFromName(partnerName) : "?";

  useEffect(() => {
    let cancelled = false;
    void listPlaces().then(result => {
      if (!cancelled) setPlaceCount(result.places.length);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <Link className="brand" href="/" aria-label="홈으로 이동">
        <span className="brand-mark">US</span>
        <span><strong>ONLY US</strong><small>private space for two</small></span>
      </Link>
      <nav className="nav-list">
        {NAVIGATION.map((item, index) => {
          if ("section" in item) return <p key={`${item.section}-${index}`}>{item.section}</p>;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const count = item.href === "/places" ? placeCount : null;
          return (
            <Link className={`nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href}>
              <span>{item.icon}</span>{item.label}
              {count != null && count > 0 && <em>{count}</em>}
            </Link>
          );
        })}
      </nav>
      <div className="couple-card">
        <div className="paired-avatars"><span className="avatar you">{youInitial}</span><span className="avatar partner">{partnerInitial}</span></div>
        <div>
          <strong>{youName} &amp; {partnerName ?? "파트너"}</strong>
          <small>
            {session.mode === "authenticated"
              ? session.partner ? "연결된 둘의 공간" : "파트너를 초대해 주세요"
              : "로그인하면 둘이 같은 공간을 봐요"}
          </small>
        </div>
        {session.mode === "authenticated" && !session.partner
          ? <Link href="/invite">초대</Link>
          : session.mode !== "authenticated"
            ? <Link href="/login">로그인</Link>
            : null}
      </div>
    </aside>
  );
}
