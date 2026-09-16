"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { AIPlanEditor } from "@/features/ai/components/AIPlanEditor";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";
import { VersionHistory } from "@/features/collaboration/components/VersionHistory";
import { ensureDemoGunsanTrip, getActiveTripDay, getDraftPlanMeta, getDraftTripItems, setActiveTripDay, setDraftPlanMeta, setDraftTripItems, subscribeDraftTrip } from "@/features/planning/draftTrip";
import { getDemoPlaces, subscribeDemoPlaces } from "@/features/places/demoPlaces";
import type { Place } from "@/features/places/types/place";
import { loadCouplePlan, saveCouplePlan } from "@/features/planning/actions";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import type { PlanChange, PlanItem } from "@/features/planning/types/plan";
import { addDays, formatKoDate, formatKoShort } from "@/lib/dates";
import { PlanMap } from "./PlanMap";
import { archiveTrip, getArchivedTrips, subscribeTripArchive, type TripJourney } from "@/features/trip/tripArchive";

type Panel = "ai" | "history" | "activity";
type Tab = "schedule" | "map" | "notes" | "archive";

function mergeDay(all: PlanItem[], dayIndex: number, nextDay: PlanItem[]) {
  const others = all.filter(item => (item.dayIndex ?? 0) !== dayIndex);
  return [...others, ...nextDay.map((item, order) => ({ ...item, dayIndex, order }))]
    .sort((a, b) => (a.dayIndex - b.dayIndex) || a.startTime.localeCompare(b.startTime) || a.order - b.order)
    .map((item, order) => ({ ...item, order }));
}

export function TripPlanner() {
  const session = useAppSession();
  const [items, setItems] = useState<PlanItem[]>([]);
  const [title, setTitle] = useState("우리가 고른 여행");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dayCount, setDayCount] = useState(1);
  const [selectedDay, setSelectedDay] = useState(0);
  const [loaded, setLoaded] = useState(true);
  const [panel, setPanel] = useState<Panel>("activity");
  const [tab, setTab] = useState<Tab>("schedule");
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [demoPlaces, setDemoPlaces] = useState<Place[]>([]);
  const [archivedTrips, setArchivedTrips] = useState<TripJourney[]>([]);
  const [archiveNotice, setArchiveNotice] = useState("");
  const revisionRef = useRef(0);
  const dayItems = useMemo(
    () => items.filter(item => (item.dayIndex ?? 0) === selectedDay),
    [items, selectedDay],
  );
  const dayLabel = `DAY ${selectedDay + 1}`;
  const dayDate = startDate ? formatKoDate(addDays(startDate, selectedDay)) : "";

  useEffect(() => {
    let cancelled = false;
    if (session.mode !== "authenticated") ensureDemoGunsanTrip();
    const stored = getDraftTripItems();
    const localMeta = getDraftPlanMeta("trip");
    const storedDays = stored.reduce((max, item) => Math.max(max, (item.dayIndex ?? 0) + 1), 1);
    const localDayCount = Math.max(1, localMeta.dayCount, storedDays);
    const active = Math.min(getActiveTripDay(), localDayCount - 1);
    setItems(stored);
    setTitle(localMeta.title);
    setNotes(localMeta.notes);
    setStartDate(localMeta.startDate);
    setDayCount(localDayCount);
    setSelectedDay(active);
    setActiveTripDay(active);
    setDemoPlaces(getDemoPlaces());
    setArchivedTrips(getArchivedTrips());
    setLoaded(true);

    const unsubscribe = subscribeDraftTrip(() => setItems(getDraftTripItems()));
    const unsubscribePlaces = subscribeDemoPlaces(() => setDemoPlaces(getDemoPlaces()));
    const unsubscribeArchive = subscribeTripArchive(() => setArchivedTrips(getArchivedTrips()));

    if (session.mode !== "authenticated") {
      return () => {
        cancelled = true;
        unsubscribe();
        unsubscribePlaces();
        unsubscribeArchive();
      };
    }

    void loadCouplePlan("trip").then(result => {
      if (cancelled) return;
      revisionRef.current = result.revision;
      if (result.persist && result.items.length) {
        setItems(result.items);
        setDraftTripItems(result.items);
      } else if (stored.length) {
        setItems(stored);
        if (result.persist) {
          void saveCouplePlan("trip", stored, { title: result.title || "우리가 고른 여행", subtitle: result.notes, startDate: result.startDate, dayCount: result.dayCount, expectedRevision: result.revision }).then(savedResult => {
            if ("version" in savedResult) {
              setVersion(savedResult.version);
              revisionRef.current = savedResult.revision;
            }
          });
        }
      }
      setTitle(result.title || localMeta.title);
      setNotes(result.notes || localMeta.notes);
      setStartDate(result.startDate || localMeta.startDate);
      const nextDayCount = Math.max(1, result.dayCount || 1, localMeta.dayCount, storedDays);
      setDayCount(nextDayCount);
      const active = Math.min(getActiveTripDay(), nextDayCount - 1);
      setSelectedDay(active);
      setActiveTripDay(active);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribePlaces();
      unsubscribeArchive();
    };
  }, [session.mode]);

  function finishTrip() {
    if (!items.length) return;
    archiveTrip({ title, startDate, dayCount, items });
    setArchiveNotice("지난 여행에 보관했어요.");
    setTab("archive");
  }

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number }) => {
    setSaved(false);
    setSaveError("");
    setItems(next);
    setDraftTripItems(next);
    setDraftPlanMeta("trip", {
      title: extra?.title ?? title,
      notes: extra?.subtitle ?? notes,
      startDate: extra && "startDate" in extra ? extra.startDate ?? "" : startDate,
      dayCount: extra?.dayCount ?? dayCount,
    });
    void saveCouplePlan("trip", next, {
      title: extra?.title ?? title,
      subtitle: extra?.subtitle ?? notes,
      startDate: extra && "startDate" in extra ? extra.startDate ?? null : startDate || null,
      dayCount: extra?.dayCount ?? dayCount,
      expectedRevision: revisionRef.current,
    }).then(result => {
      if ("version" in result) {
        setVersion(result.version);
        revisionRef.current = result.revision;
      } else {
        setSaveError(result.error);
      }
      setSaved(true);
    });
  };

  const apply = (changes: PlanChange[]) => {
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
    setPanel("history");
  };

  const replace = (next: PlanItem[]) => {
    persist(mergeDay(items, selectedDay, next));
    setPanel("history");
  };

  const updateItem = (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => {
    persist(items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const selectDay = (day: number) => {
    setSelectedDay(day);
    setActiveTripDay(day);
  };

  const addDay = () => {
    if (dayCount >= 7) return;
    const nextCount = dayCount + 1;
    setDayCount(nextCount);
    selectDay(dayCount);
    persist(items, { dayCount: nextCount });
  };

  const removeLastDay = () => {
    if (dayCount <= 1) return;
    const last = dayCount - 1;
    if (items.some(item => (item.dayIndex ?? 0) === last)) return;
    const nextCount = dayCount - 1;
    setDayCount(nextCount);
    selectDay(Math.min(selectedDay, nextCount - 1));
    persist(items, { dayCount: nextCount });
  };

  const context = panel === "ai"
    ? <AIPlanEditor kind="trip" items={dayItems.length ? dayItems : items} places={demoPlaces.length ? demoPlaces : undefined} onApply={apply} onReplace={replace} />
    : panel === "activity"
      ? <ActivityPanel />
      : <VersionHistory kind="trip" latest={version} onRestore={replace} />;

  return (
    <AppShell context={context}>
      <div className="trip-header">
        <div>
          <span className="eyebrow">{items.length ? `TRIP · ${dayCount} DAYS · ${items.length} PLACES` : "TRIP"}</span>
          {loaded && items.length ? (
            <input className="title-input" value={title} onChange={event => setTitle(event.target.value)} onBlur={() => persist(items, { title })} aria-label="여행 제목" />
          ) : (
            <h1>{!loaded ? "일정을 불러오는 중이에요" : "아직 잡아 둔 여행이 없어요"}</h1>
          )}
          {!items.length && (
            <p>{!loaded ? "저장된 하루를 가져오고 있어요." : "장소를 담고, 필요하면 AI가 하루 순서를 잡아 줘요."}</p>
          )}
        </div>
        <div className="page-actions date-planner-actions trip-planner-actions">
          <DatePickerButton
            value={startDate}
            emptyLabel="시작일 고르기"
            ariaLabel="여행 시작일"
            onChange={value => {
              setStartDate(value);
              persist(items, { startDate: value || null });
            }}
          />
          <div className="save-status"><i /> {saveError || (saved ? "저장됨" : "저장 중...")}</div>
          {items.length > 0 && <button className="outline-button trip-finish-button" type="button" onClick={finishTrip}>지난 여행</button>}
          <div className="date-action-group">
            <button className={`date-action-button is-history ${panel === "activity" ? "is-active" : ""}`} type="button" onClick={() => setPanel("activity")}>
              <HeaderActionIcon name="activity" /><span>최근 활동</span>
            </button>
            <button className={`date-action-button is-ai ${panel === "ai" ? "is-active" : ""}`} type="button" onClick={() => setPanel("ai")}>
              <HeaderActionIcon name="sparkles" /><span>AI로 다듬기</span>
            </button>
          </div>
        </div>
      </div>
      <div className="trip-tabs">
        <button className={tab === "schedule" ? "is-active" : ""} type="button" onClick={() => setTab("schedule")}>일정</button>
        <button className={tab === "map" ? "is-active" : ""} type="button" onClick={() => setTab("map")}>지도</button>
        <button className={tab === "notes" ? "is-active" : ""} type="button" onClick={() => setTab("notes")}>여행 노트</button>
        <button className={tab === "archive" ? "is-active" : ""} type="button" onClick={() => setTab("archive")}>지난 여행</button>
        <button type="button" onClick={() => setPanel("history")}>변경 기록</button>
      </div>

      {tab === "archive" ? (
        <section className="trip-archive paper-card">
          <div className="trip-archive-head"><div><span className="eyebrow">PAST JOURNEYS</span><h2>함께 다녀온 여행</h2></div>{archiveNotice && <p>{archiveNotice}</p>}</div>
          <div className="trip-archive-grid">{archivedTrips.map(journey => <article key={journey.id}><span>{journey.startDate || "날짜 미정"}</span><h3>{journey.title}</h3><p>{journey.dayCount}일 · {journey.items.length}곳</p><Link href="/our-map">기억 지도에서 보기 →</Link></article>)}</div>
        </section>
      ) : tab === "notes" ? (
        <section className="plan-notes paper-card">
          <span className="eyebrow">TRIP NOTES</span>
          <h2>둘이 남기는 메모</h2>
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            onBlur={() => persist(items, { subtitle: notes })}
            placeholder="숙소 체크인, 꼭 먹고 싶은 것, 비 올 때 대안..."
            rows={8}
          />
          <p className="form-hint">포커스를 벗어나면 저장돼요. 파트너도 같은 공간에서 볼 수 있어요.</p>
        </section>
      ) : (
        <div className="planner-shell">
          <aside className="day-rail">
            <span className="eyebrow">DAYS</span>
            {Array.from({ length: dayCount }, (_, day) => {
              const count = items.filter(item => (item.dayIndex ?? 0) === day).length;
              return (
                <button className={selectedDay === day ? "is-active" : ""} type="button" key={day} onClick={() => selectDay(day)}>
                  <b>DAY {day + 1}</b>
                  <small>{startDate ? formatKoShort(addDays(startDate, day)) : `${count}곳`}</small>
                  <i>{count}</i>
                </button>
              );
            })}
            {dayCount < 7 && <button className="add-day" type="button" onClick={addDay}>하루 추가</button>}
            {dayCount > 1 && !items.some(item => (item.dayIndex ?? 0) === dayCount - 1) && (
              <button className="add-day" type="button" onClick={removeLastDay}>빈 하루 빼기</button>
            )}
            <div className="trip-note">너무 많이 말고,<br />좋아하는 곳에 오래.</div>
          </aside>
          {tab === "map" ? (
            dayItems.length ? <PlanMap items={dayItems} dayLabel={dayLabel} /> : (
              <div className="empty-soft planner-empty">
                <h1>이 날에 올릴 장소가 없어요</h1>
                <p>일정에 장소를 담으면 여기서 순서를 보여 줘요.</p>
                <Link className="primary-button" href={`/places?from=trip&day=${selectedDay}`}>이 날의 장소 찾기</Link>
              </div>
            )
          ) : (
            <section className="plan-column">
              <div className="plan-day-head">
                <div>
                  <span className="eyebrow">{dayLabel}</span>
                  <h2>{dayItems.length ? "이 날에 담은 장소" : "이 날은 아직 비어 있어요"}</h2>
                  {startDate && <p className="form-hint">{dayDate}</p>}
                </div>
              </div>
              {loaded && !dayItems.length ? (
                <div className="empty-soft planner-empty">
                  <h1>{items.length ? "이날은 비어 있어요" : "여행 초안이 비어 있어요"}</h1>
                  <p>Places에서 담고, 오른쪽 AI로 3안을 만들 수 있어요. 담기는 지금 고른 날에 붙어요.</p>
                  <div className="dialog-actions">
                <Link className="primary-button" href={`/places?from=trip&day=${selectedDay}`}>이 날의 장소 찾기</Link>
                {demoPlaces.length > 0 && <button className="outline-button" type="button" onClick={() => setPanel("ai")}>저장한 장소로 3안 만들기</button>}
                  </div>
                </div>
              ) : (
                <>
                  <PlanTimeline
                    items={dayItems}
                    onReorder={next => persist(mergeDay(items, selectedDay, next))}
                    onUpdate={updateItem}
                    onRemove={id => persist(items.filter(item => item.id !== id))}
                  />
                  <Link className="add-schedule" href={`/places?from=trip&day=${selectedDay}`}>＋ 이 날에 장소 추가</Link>
                </>
              )}
            </section>
          )}
          {tab === "schedule" && dayItems.length ? <PlanMap items={dayItems} dayLabel={dayLabel} /> : null}
        </div>
      )}
    </AppShell>
  );
}
