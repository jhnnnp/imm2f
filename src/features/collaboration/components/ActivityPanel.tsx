"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { preloadCoupleActivities } from "../activityClient";
import { hrefForActivity, type CoupleActivity } from "../types";

function ActivityIcon({ action }: { action: string }) {
  const type = action.startsWith("TRIP") ? "trip" : action.startsWith("DATE") ? "calendar" :
    action.startsWith("PLACE") ? "place" : action.startsWith("MEMORY") ? "heart" :
      action === "PARTNER_JOINED" ? "couple" : "note";
  const paths = {
    trip: <><path d="M4 15.5 20 8l-7.5 16-2-6.5L4 15.5Z"/><path d="m10.5 17.5 3-3"/></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3"/></>,
    place: <><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></>,
    heart: <path d="M20.5 8.8c0 5.2-8.5 10.2-8.5 10.2S3.5 14 3.5 8.8A4.3 4.3 0 0 1 12 7.7a4.3 4.3 0 0 1 8.5 1.1Z"/>,
    couple: <><circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3.5 20c.5-4 2.5-6 5.5-6s5 2 5.5 6M14 15c3-.5 5.5 1.2 6 4"/></>,
    note: <><rect x="5" y="4" width="14" height="16" rx="3"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/></>,
  }[type];
  return <span className={`activity-symbol is-${type}`} aria-hidden="true"><svg viewBox="0 0 24 24">{paths}</svg></span>;
}

export function ActivityPanel({ initialItems }: { initialItems?: CoupleActivity[] }) {
  const session = useAppSession();
  const [items, setItems] = useState<CoupleActivity[]>(initialItems ?? []);
  const [loaded, setLoaded] = useState(initialItems !== undefined || session.mode !== "authenticated");
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialItems !== undefined) {
      setItems(initialItems);
      setLoaded(true);
      return;
    }
    if (session.mode !== "authenticated") {
      setItems([]);
      setLoaded(true);
      return;
    }

    let cancelled = false;
    setLoaded(false);
    setError("");
    void preloadCoupleActivities().then(next => {
      if (cancelled) return;
      setItems(next);
    }).catch(() => {
      if (!cancelled) setError("이야기를 불러오지 못했어요.");
    }).finally(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialItems, session.mode]);

  return (
    <div>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">TODAY</span>
          <h2>오늘의 이야기</h2>
        </div>
      </div>
      <div className="activity-feed">
        {!loaded && <div className="panel-loading" aria-label="이야기 불러오는 중"><i /><i /><i /></div>}
        {error && <p className="panel-error" role="alert">{error}</p>}
        {loaded && !items.length && (
          <p className="form-hint">아직 기록이 없어요. 장소를 저장하거나 일정을 바꾸면 여기에 쌓여요.</p>
        )}
        {items.map(item => {
          return (
            <Link className={`activity-item ${item.important ? "important" : ""}`} href={hrefForActivity(item.action)} key={item.id}>
              <ActivityIcon action={item.action} />
              <div className="activity-copy">
                <b>{item.title}</b>
                <small>{item.actorName} · {item.createdAt}</small>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
