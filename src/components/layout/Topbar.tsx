"use client";

import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/shared/CommandPalette";

export function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <>
    <header className="topbar">
      <div className="today"><span>우리의 공간</span><b>2026년 9월 16일, 수요일</b></div>
      <button className="global-search" onClick={() => setSearchOpen(true)} aria-label="전체 검색 열기"><span>⌕</span><b>장소, 여행, 추억 검색</b><kbd>⌘ K</kbd></button>
      <button className="icon-button notification-button" aria-label="알림 보기">♢<i /></button>
      <button className="profile-button" aria-label="프로필">지은</button>
    </header>
    <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
  </>;
}
