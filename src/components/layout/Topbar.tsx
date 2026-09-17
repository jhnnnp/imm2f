"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { initialFromName } from "@/features/auth/types";
import { signOut } from "@/features/auth/session";
import { preloadCoupleActivities } from "@/features/collaboration/activityClient";
import { hrefForActivity, type CoupleActivity } from "@/features/collaboration/types";

function todayLabel() {
  return new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export function Topbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [activities, setActivities] = useState<CoupleActivity[]>([]);
  const [notifyLoaded, setNotifyLoaded] = useState(false);
  const [today, setToday] = useState("");
  const notifyRef = useRef<HTMLDivElement>(null);
  const notifyLoadingRef = useRef(false);
  const session = useAppSession();
  const label = session.mode === "authenticated" || session.mode === "setup_error" ? initialFromName(session.displayName) : "나";
  const unread = useMemo(() => activities.filter(item => item.important).length, [activities]);

  useEffect(() => {
    setToday(todayLabel());
    if (session.mode === "authenticated") {
      notifyLoadingRef.current = true;
      void preloadCoupleActivities(8).then(next => {
        setActivities(next);
        setNotifyLoaded(true);
      }).catch(() => {
        setNotifyLoaded(true);
      }).finally(() => {
        notifyLoadingRef.current = false;
      });
    } else {
      setNotifyLoaded(true);
    }
  }, [session.mode]);

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

  const openNotifications = () => {
    setNotifyOpen(open => !open);
    setMenuOpen(false);
    if (notifyLoaded || notifyLoadingRef.current) return;
    notifyLoadingRef.current = true;
    void preloadCoupleActivities(8).then(next => {
      setActivities(next);
      setNotifyLoaded(true);
      notifyLoadingRef.current = false;
    });
  };

  useEffect(() => {
    if (!notifyOpen && !menuOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifyRef.current && !notifyRef.current.contains(target)) setNotifyOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [notifyOpen, menuOpen]);

  return <>
    <header className="topbar">
      <div className="today"><span>우리의 공간</span><b suppressHydrationWarning>{today || "오늘"}</b></div>
      <button className="global-search" type="button" onClick={() => setSearchOpen(true)} aria-label="전체 검색 열기">
        <span>⌕</span><b>장소, 여행, 추억 검색</b><kbd>⌘K</kbd>
      </button>
      <div className="notify-wrap" ref={notifyRef}>
        <button
          className="icon-button notification-button"
          type="button"
          aria-label="최근 활동 보기"
          aria-expanded={notifyOpen}
          onClick={openNotifications}
        >
          ◌{unread > 0 && <i />}
        </button>
        {notifyOpen && (
          <div className="notify-popover" role="dialog" aria-label="최근 활동">
            <p>최근 활동</p>
            {!notifyLoaded && <small>불러오는 중이에요.</small>}
            {notifyLoaded && !activities.length && <small>아직 알릴 변화가 없어요.</small>}
            {activities.slice(0, 6).map(item => (
              <Link href={hrefForActivity(item.action)} key={item.id} onClick={() => setNotifyOpen(false)}>
                <b>{item.title}</b>
                <small>{item.actorName} · {item.createdAt}</small>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="account-menu">
        <button className="profile-button" type="button" aria-label="프로필 메뉴" aria-expanded={menuOpen} onClick={() => { setMenuOpen(open => !open); setNotifyOpen(false); }}>{label}</button>
        {menuOpen && (
          <div className="account-popover" role="menu">
            {session.mode === "authenticated" ? (
              <>
                <p>{session.displayName}</p>
                <Link href="/invite" role="menuitem" onClick={() => setMenuOpen(false)}>{session.partner ? "연결 상태" : "파트너 초대"}</Link>
                <button type="button" role="menuitem" onClick={() => void signOut()}>로그아웃</button>
              </>
            ) : session.mode === "setup_error" ? (
              <>
                <p>로그인은 됐지만 공간을 준비하지 못했어요.</p>
                <button type="button" role="menuitem" onClick={() => void signOut()}>다시 로그인</button>
              </>
            ) : (
              <>
                <p>아직 로그인하지 않았어요</p>
                <Link href="/login" role="menuitem" onClick={() => setMenuOpen(false)}>로그인</Link>
                <Link href="/signup" role="menuitem" onClick={() => setMenuOpen(false)}>공간 만들기</Link>
              </>
            )}
          </div>
        )}
      </div>
    </header>
    <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
  </>;
}
