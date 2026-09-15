"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION } from "./navigation";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <Link className="brand" href="/" aria-label="홈으로 이동">
        <span className="brand-mark">✦</span>
        <span><strong>ONLY US</strong><small>private space for two</small></span>
      </Link>
      <nav className="nav-list">
        {NAVIGATION.map((item, index) => {
          if ("section" in item) return <p key={`${item.section}-${index}`}>{item.section}</p>;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <Link className={`nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href}><span>{item.icon}</span>{item.label}{"count" in item && <em>{item.count}</em>}</Link>;
        })}
      </nav>
      <div className="couple-card">
        <div className="paired-avatars"><span className="avatar you">지</span><span className="avatar partner">상</span></div>
        <div><strong>지은 &amp; 상민</strong><small>함께한 지 1,842일</small></div>
        <button aria-label="설정">•••</button>
      </div>
    </aside>
  );
}
