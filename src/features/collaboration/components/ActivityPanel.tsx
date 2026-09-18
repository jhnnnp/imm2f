"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { useTossDismiss } from "@/lib/useTossDismiss";
import { invalidateCoupleActivities, preloadCoupleActivities } from "../activityClient";
import { clearCoupleActivities, dismissCoupleActivities } from "../actions";
import { hrefForActivity, type CoupleActivity } from "../types";

type ActivityGroup = CoupleActivity & { ids: string[]; count: number };

function ActivityIcon({ action }: { action: string }) {
  const type = action.startsWith("TRIP") ? "trip" : action.startsWith("DATE") ? "calendar" :
    action.startsWith("PLACE") ? "place" :       action.startsWith("MEMORY") ? "heart" :
      action.startsWith("PARTNER") ? "couple" : "note";
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

function groupActivities(items: CoupleActivity[]) {
  return items.reduce<ActivityGroup[]>((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.action === item.action && last.title === item.title && last.actorUserId === item.actorUserId) {
      last.ids.push(item.id);
      last.count += 1;
      return groups;
    }
    groups.push({ ...item, ids: [item.id], count: 1 });
    return groups;
  }, []);
}

export function ActivityPanel({ initialItems }: { initialItems?: CoupleActivity[] }) {
  const router = useRouter();
  const session = useAppSession();
  const feedRef = useRef<HTMLDivElement>(null);
  const skipClick = useRef(false);
  const dragged = useRef<string[] | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [items, setItems] = useState<CoupleActivity[]>(initialItems ?? []);
  const [loaded, setLoaded] = useState(initialItems !== undefined || session.mode !== "authenticated");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const dismissing = useTossDismiss(Boolean(draggingId), feedRef);
  const dismissingRef = useRef(false);
  dismissingRef.current = dismissing;
  const groups = useMemo(() => groupActivities(items), [items]);

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

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const refresh = () => {
    invalidateCoupleActivities();
    void preloadCoupleActivities(8, true);
    void preloadCoupleActivities(20, true);
  };

  const toss = (ids: string[]) => {
    const previous = items;
    setItems(current => current.filter(item => !ids.includes(item.id)));
    setStatus(ids.length > 1 ? "같은 이야기를 지웠어요" : "이야기를 지웠어요");
    refresh();
    void dismissCoupleActivities(ids).then(result => {
      if (result.error) {
        setItems(previous);
        setError(result.error);
        setStatus("");
      }
    });
  };

  const askClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmClear(false);
    const previous = items;
    setItems([]);
    setStatus("오늘의 이야기를 비웠어요");
    refresh();
    void clearCoupleActivities().then(result => {
      if (result.error) {
        setItems(previous);
        setError(result.error);
        setStatus("");
      }
    });
  };

  return (
    <div>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">TODAY</span>
          <h2>오늘의 이야기</h2>
          {items.length > 0 && (
            <button
              className={`activity-clear${confirmClear ? " is-confirm" : ""}`}
              type="button"
              onClick={askClear}
            >
              {confirmClear ? "정말 지울까요?" : "모두 비우기"}
            </button>
          )}
        </div>
      </div>
      <div
        ref={feedRef}
        className={`activity-feed${dismissing ? " is-tossing" : ""}`}
        data-toss-hint="바깥에 놓으면 지워져요"
      >
        {!loaded && <div className="panel-loading" aria-label="이야기 불러오는 중"><i /><i /><i /></div>}
        {error && <p className="panel-error" role="alert">{error}</p>}
        {status && <p className="sr-only" role="status">{status}</p>}
        {loaded && !items.length && (
          <p className="form-hint">아직 기록이 없어요. 장소를 저장하거나 일정을 바꾸면 여기에 쌓여요.</p>
        )}
        {groups.map(group => {
          const active = draggingId === group.id;
          const href = hrefForActivity(group.action);
          return (
            <article
              className={`activity-item ${group.important ? "important" : ""}${group.count > 1 ? " is-stack" : ""}${active ? " is-dragging" : ""}${active && dismissing ? " is-toss" : ""}`}
              key={group.ids.join("-")}
              draggable
              role="link"
              tabIndex={0}
              aria-label={group.count > 1
                ? `${group.title}. 같은 이야기 ${group.count}개. 바깥으로 끌면 함께 지워져요.`
                : `${group.title}. 바깥으로 끌면 지워져요.`}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", group.id);
                dragged.current = group.ids;
                skipClick.current = true;
                setDraggingId(group.id);
              }}
              onDragEnd={() => {
                if (dismissingRef.current && dragged.current) toss(dragged.current);
                dragged.current = null;
                setDraggingId(null);
                window.setTimeout(() => {
                  skipClick.current = false;
                }, 0);
              }}
              onClick={() => {
                if (skipClick.current) {
                  skipClick.current = false;
                  return;
                }
                router.push(href);
              }}
              onKeyDown={event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                router.push(href);
              }}
            >
              <ActivityIcon action={group.action} />
              <div className="activity-copy">
                <b>{group.title}</b>
                <small>{group.actorName} · {group.createdAt}</small>
                {group.detail ? <p>{group.detail}</p> : null}
                {group.count > 1 ? <em className="activity-count">같은 이야기 {group.count}개</em> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
