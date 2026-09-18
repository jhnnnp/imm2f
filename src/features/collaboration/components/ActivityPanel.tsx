"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useTossDismiss } from "@/lib/useTossDismiss";
import { emitCoupleActivitiesChanged } from "../activityClient";
import { groupActivities, withoutDismissedActivities } from "../activityFeed";
import { useCoupleActivityFeed } from "../activityLive";
import { clearCoupleActivities, dismissCoupleActivities } from "../actions";
import { hrefForActivity, type CoupleActivity } from "../types";

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

function ActivityCard({
  item,
  count,
  stacked,
  open,
  nested,
  active,
  tossing,
  onActivate,
  onDragStart,
  onDragEnd,
}: {
  item: CoupleActivity;
  count: number;
  stacked?: boolean;
  open?: boolean;
  nested?: boolean;
  active: boolean;
  tossing: boolean;
  onActivate: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const stackedCount = stacked && count > 1;
  const label = stackedCount
    ? `${item.title}. 같은 이야기 ${count}개. ${open ? "누르면 접혀요." : "누르면 아래에 열려요."} 바깥으로 끌면 함께 지워져요.`
    : `${item.title}. 바깥으로 끌면 지워져요.`;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate();
  };

  return (
    <article
      className={`activity-item ${item.important ? "important" : ""}${stackedCount ? " is-stack" : ""}${open ? " is-open" : ""}${nested ? " is-nested" : ""}${active ? " is-dragging" : ""}${active && tossing ? " is-toss" : ""}`}
      draggable
      role={stackedCount ? "button" : "link"}
      tabIndex={0}
      aria-expanded={stackedCount ? open : undefined}
      aria-label={label}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      <ActivityIcon action={item.action} />
      <div className="activity-copy">
        <b>{item.title}</b>
        <small>{item.actorName} · {item.createdAt}</small>
        {!open && item.detail ? <p>{item.detail}</p> : null}
        {stackedCount ? <em className="activity-count">{open ? "이야기 접기" : `같은 이야기 ${count}개`}</em> : null}
      </div>
    </article>
  );
}

export function ActivityPanel() {
  const router = useRouter();
  const live = useCoupleActivityFeed(20);
  const feedRef = useRef<HTMLDivElement>(null);
  const skipClick = useRef(false);
  const dragged = useRef<string[] | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedIdsRef = useRef(new Set<string>());
  const [dismissTick, setDismissTick] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const dismissing = useTossDismiss(Boolean(draggingId), feedRef);
  const dismissingRef = useRef(false);
  dismissingRef.current = dismissing;
  const items = useMemo(
    () => withoutDismissedActivities(live.items, dismissedIdsRef.current),
    [live.items, dismissTick],
  );
  const groups = useMemo(() => groupActivities(items), [items]);
  const loaded = live.loaded;
  const feedError = error || live.error;

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const toss = (ids: string[]) => {
    ids.forEach(id => dismissedIdsRef.current.add(id));
    setDismissTick(value => value + 1);
    setError("");
    setStatus(ids.length > 1 ? "같은 이야기를 지웠어요" : "이야기를 지웠어요");
    void dismissCoupleActivities(ids).then(result => {
      if (result.error) {
        ids.forEach(id => dismissedIdsRef.current.delete(id));
        setDismissTick(value => value + 1);
        setError(result.error);
        setStatus("");
        return;
      }
      emitCoupleActivitiesChanged();
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
    const ids = items.map(item => item.id);
    ids.forEach(id => dismissedIdsRef.current.add(id));
    setDismissTick(value => value + 1);
    setStatus("오늘의 이야기를 비웠어요");
    void clearCoupleActivities().then(result => {
      if (result.error) {
        ids.forEach(id => dismissedIdsRef.current.delete(id));
        setDismissTick(value => value + 1);
        setError(result.error);
        setStatus("");
        return;
      }
      emitCoupleActivitiesChanged();
    });
  };

  const beginDrag = (event: DragEvent<HTMLElement>, ids: string[], dragId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragId);
    dragged.current = ids;
    skipClick.current = true;
    setDraggingId(dragId);
  };

  const endDrag = () => {
    if (dismissingRef.current && dragged.current) toss(dragged.current);
    dragged.current = null;
    setDraggingId(null);
    window.setTimeout(() => {
      skipClick.current = false;
    }, 0);
  };

  const activate = (next: () => void) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    next();
  };

  const toggleGroup = (key: string) => {
    setOpenKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
        {feedError && <p className="panel-error" role="alert">{feedError}</p>}
        {status && <p className="sr-only" role="status">{status}</p>}
        {loaded && !items.length && (
          <p className="form-hint">아직 기록이 없어요. 장소를 저장하거나 일정을 바꾸면 여기에 쌓여요.</p>
        )}
        {groups.map(group => {
          const ids = group.items.map(item => item.id);
          const stacked = ids.length > 1;
          const open = stacked && openKeys.has(group.id);
          const href = hrefForActivity(group.action);
          return (
            <div className={`activity-stack${open ? " is-open" : ""}`} key={group.id}>
              <ActivityCard
                item={group}
                count={ids.length}
                stacked={stacked}
                open={open}
                active={draggingId === group.id}
                tossing={dismissing}
                onActivate={() => activate(() => stacked ? toggleGroup(group.id) : router.push(href))}
                onDragStart={event => beginDrag(event, ids, group.id)}
                onDragEnd={endDrag}
              />
              {open ? (
                <div className="activity-stack-list">
                  {group.items.map(item => (
                    <ActivityCard
                      key={item.id}
                      item={item}
                      count={1}
                      nested
                      active={draggingId === item.id}
                      tossing={dismissing}
                      onActivate={() => activate(() => router.push(hrefForActivity(item.action)))}
                      onDragStart={event => beginDrag(event, [item.id], item.id)}
                      onDragEnd={endDrag}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
