"use client";

import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { useMemo, useRef, useState } from "react";
import { useHydratePlanCoordinates } from "@/features/planning/useHydratePlanCoordinates";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import type { CourseKeepInput, CourseKeepResult } from "@/features/ai/courseKeep";
import { archiveTripPlan, listArchivedTripPlans, loadCouplePlan, saveCouplePlan, type ArchivedTripPlan } from "@/features/planning/actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { stripLegacyDemoArchive, stripLegacyDemoPlan } from "@/features/planning/legacyDemo";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import type { CouplePlan, PlanChange, PlanItem } from "@/features/planning/types/plan";
import { addDays, formatKoDate, formatKoShort } from "@/lib/dates";
import { itemsForDay, replacePlanDay } from "@/features/planning/planOrder";
import { PlanMap } from "./PlanMap";

const AIPlanEditor = dynamic(
  () => import("@/features/ai/components/AIPlanEditor").then(mod => mod.AIPlanEditor),
  { ssr: false, loading: () => <div className="panel-loading" aria-label="AI 플래너 불러오는 중"><i /><i /><i /></div> },
);

type Panel = "ai" | "activity";
type Tab = "schedule" | "map" | "notes" | "archive";

export function TripPlanner({
  initialPlan,
  initialArchives,
  initialDay = 0,
}: {
  initialPlan: CouplePlan;
  initialArchives: ArchivedTripPlan[];
  initialDay?: number;
}) {
  const router = useRouter();
  const plan = stripLegacyDemoPlan(initialPlan);
  const [items, setItems] = useState<PlanItem[]>(plan.items);
  const [title, setTitle] = useState(plan.title || "우리가 고른 여행");
  const [notes, setNotes] = useState(plan.notes);
  const [startDate, setStartDate] = useState(plan.startDate || "");
  const [dayCount, setDayCount] = useState(Math.max(1, plan.dayCount || 1));
  const [selectedDay, setSelectedDay] = useState(Math.max(0, Math.min(initialDay, plan.dayCount - 1)));
  const [panel, setPanel] = useState<Panel>("activity");
  const [tab, setTab] = useState<Tab>("schedule");
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [archivedTrips, setArchivedTrips] = useState<ArchivedTripPlan[]>(() => initialArchives.flatMap(journey => {
    const next = stripLegacyDemoArchive(journey);
    return next ? [next] : [];
  }));
  const [archiveNotice, setArchiveNotice] = useState("");
  const revisionRef = useRef(initialPlan.revision);
  const dirtyRef = useRef(false);
  const pendingSaves = useRef(0);
  useSharedRefresh(async () => {
    if (dirtyRef.current) return;
    const remote = await loadCouplePlan("trip");
    if (dirtyRef.current || remote.revision === revisionRef.current) return;
    revisionRef.current = remote.revision;
    setItems(remote.items); setTitle(remote.title); setNotes(remote.notes);
    setStartDate(remote.startDate ?? ""); setDayCount(remote.dayCount);
    setSelectedDay(day => Math.min(day, Math.max(0, remote.dayCount - 1)));
  });
  const saveQueueRef = useRef(Promise.resolve());
  useHydratePlanCoordinates("trip", items, setItems);

  const dayItems = useMemo(
    () => itemsForDay(items, selectedDay),
    [items, selectedDay],
  );
  const dayLabel = `DAY ${selectedDay + 1}`;
  const dayDate = startDate ? formatKoDate(addDays(startDate, selectedDay)) : "";

  async function finishTrip() {
    if (!items.length) return;
    const result = await archiveTripPlan({ title, startDate, dayCount, items });
    if ("error" in result) { setSaveError(result.error); return; }
    emitCoupleActivitiesChanged();
    setArchivedTrips(await listArchivedTripPlans());
    setArchiveNotice("둘이 공유하는 지난 여행에 보관했어요.");
    setTab("archive");
  }

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number }) => {
    dirtyRef.current = true;
    pendingSaves.current += 1;
    setSaved(false);
    setSaveError("");
    setItems(next);
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(async () => {
      const result = await saveCouplePlan("trip", next, {
        title: extra?.title ?? title,
        subtitle: extra?.subtitle ?? notes,
        startDate: extra && "startDate" in extra ? extra.startDate ?? null : startDate || null,
        dayCount: extra?.dayCount ?? dayCount,
        expectedRevision: revisionRef.current,
      });
      if ("version" in result) {
        revisionRef.current = result.revision;
        emitCoupleActivitiesChanged();
      } else setSaveError(result.error);
      pendingSaves.current -= 1;
      dirtyRef.current = pendingSaves.current > 0 || "error" in result;
      setSaved(pendingSaves.current === 0);
    }).catch(() => { pendingSaves.current = Math.max(0, pendingSaves.current - 1); setSaveError("아직 저장되지 않았어요. 연결을 확인하고 다시 시도해 주세요."); });
  };

  const apply = (changes: PlanChange[]) => {
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
  };

  const replace = (next: PlanItem[]) => {
    persist(replacePlanDay(items, selectedDay, next));
  };

  const keepCourse = async (input: CourseKeepInput): Promise<CourseKeepResult> => {
    if (input.destination === "trip") {
      setStartDate(input.startDate || "");
      setDayCount(input.dayCount);
      if (input.title) setTitle(input.title);
      persist(input.items, {
        title: input.title,
        startDate: input.startDate,
        dayCount: input.dayCount,
      });
      setSelectedDay(0);
      setTab("schedule");
      return { ok: true };
    }
    setSaveError("");
    const current = await loadCouplePlan("date");
    const result = await saveCouplePlan("date", input.items, {
      title: input.title || current.title || "우리가 고른 데이트",
      subtitle: current.notes,
      startDate: input.startDate,
      dayCount: 1,
      expectedRevision: current.revision,
    });
    if ("error" in result) {
      setSaveError(result.error);
      return result;
    }
    emitCoupleActivitiesChanged();
    router.push("/date");
    return { ok: true };
  };

  const updateItem = (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => {
    persist(items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const selectDay = (day: number) => {
    setSelectedDay(day);
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

  return (
    <>
      {panel === "ai" && (
        <ContextPanel>
          <AIPlanEditor kind="trip" items={dayItems.length ? dayItems : items} startDate={startDate} onApply={apply} onReplace={replace} onKeep={keepCourse} />
        </ContextPanel>
      )}
      <div className="trip-header">
        <div>
          <span className="eyebrow">{items.length ? `TRIP · ${dayCount} DAYS · ${items.length} PLACES` : "TRIP"}</span>
          {items.length ? (
            <input className="title-input" value={title} onChange={event => { dirtyRef.current = true; setTitle(event.target.value); }} onBlur={() => persist(items, { title })} aria-label="여행 제목" />
          ) : (
            <h1>아직 잡아 둔 여행이 없어요</h1>
          )}
          {!items.length && (
            <p>장소를 담고, 필요하면 AI가 하루 순서를 잡아 줘요.</p>
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
      </div>

      {tab === "archive" ? (
        <section className="trip-archive paper-card">
          <div className="trip-archive-head"><div><span className="eyebrow">PAST JOURNEYS</span><h2>함께 다녀온 여행</h2></div>{archiveNotice && <p>{archiveNotice}</p>}</div>
          {archivedTrips.length ? (
            <div className="trip-archive-grid">{archivedTrips.map(journey => <article key={journey.id}><span>{journey.startDate || "날짜 미정"}</span><h3>{journey.title}</h3><p>{journey.dayCount}일 · {journey.items.length}곳</p><Link href="/our-map">기억 지도에서 보기 →</Link></article>)}</div>
          ) : (
            <p className="form-hint">아직 지난 여행이 없어요. 일정을 마치면 여기에 남아요.</p>
          )}
        </section>
      ) : tab === "notes" ? (
        <section className="plan-notes paper-card">
          <span className="eyebrow">TRIP NOTES</span>
          <h2>둘이 남기는 메모</h2>
          <textarea
            value={notes}
            onChange={event => { dirtyRef.current = true; setNotes(event.target.value); }}
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
            dayItems.length ? <PlanMap items={dayItems} dayLabel={dayLabel} expanded /> : (
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
              {!dayItems.length ? (
                <div className="empty-soft planner-empty">
                  <h1>{items.length ? "이날은 비어 있어요" : "여행 초안이 비어 있어요"}</h1>
                  <p>함께 가고 싶은 장소를 이 날짜에 담아 보세요. AI에게 하루 코스를 추천받을 수도 있어요.</p>
                  <div className="dialog-actions">
                <Link className="primary-button" href={`/places?from=trip&day=${selectedDay}`}>이 날의 장소 찾기</Link>
                <button className="outline-button" type="button" onClick={() => setPanel("ai")}>여행 코스 추천받기</button>
                  </div>
                </div>
              ) : (
                <>
                  <PlanTimeline
                    items={dayItems}
                    onReorder={next => persist(replacePlanDay(items, selectedDay, next))}
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
    </>
  );
}
