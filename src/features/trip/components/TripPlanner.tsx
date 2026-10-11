"use client";

import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useHydratePlanCoordinates } from "@/features/planning/useHydratePlanCoordinates";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { openContextPanel } from "@/components/layout/ContextPanelDrawer";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { courseKeepError, type CourseKeepInput, type CourseKeepResult } from "@/features/ai/courseKeep";
import { archiveTripPlan, listArchivedTripPlans, loadCouplePlan, saveCouplePlan, type ArchivedTripPlan } from "@/features/planning/actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { stripLegacyDemoArchive, stripLegacyDemoPlan } from "@/features/planning/legacyDemo";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import type { CouplePlan, PlanChange, PlanItem } from "@/features/planning/types/plan";
import { addDays, formatKoDate, formatKoShort } from "@/lib/dates";
import { itemsForDay, movePlanItemToDay, replacePlanDay } from "@/features/planning/planOrder";
import { createPlanSaveQueue } from "@/features/planning/saveQueue";
import { readTripWorkspace } from "@/features/collaboration/workspaceReads";
import { SyncNotice } from "@/components/shared/SyncNotice";
import { tripSnapshotRecorded } from "../archiveSnapshot";

const PlanMap = dynamic(() => import("./PlanMap").then(mod => mod.PlanMap), {
  ssr: false,
  loading: () => <div className="plan-map page-loading" aria-busy="true" aria-label="여행 지도 불러오는 중" />,
});

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
  candidateExplorationActive = false,
}: {
  initialPlan: CouplePlan;
  initialArchives: ArchivedTripPlan[];
  initialDay?: number;
  candidateExplorationActive?: boolean;
}) {
  const router = useRouter();
  const plan = stripLegacyDemoPlan(initialPlan);
  const [items, setItems] = useState<PlanItem[]>(plan.items);
  const [title, setTitle] = useState(plan.title || "우리가 고른 여행");
  const [notes, setNotes] = useState(plan.notes);
  const [startDate, setStartDate] = useState(plan.startDate || "");
  const [dayCount, setDayCount] = useState(Math.max(1, plan.dayCount || 1));
  const [selectedDay, setSelectedDay] = useState(Math.max(0, Math.min(Math.floor(initialDay) || 0, Math.max(1, plan.dayCount) - 1)));
  const [panel, setPanel] = useState<Panel>("activity");
  const [tab, setTab] = useState<Tab>("schedule");
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [reloading, setReloading] = useState(false);
  const [archivedTrips, setArchivedTrips] = useState<ArchivedTripPlan[]>(() => initialArchives.flatMap(journey => {
    const next = stripLegacyDemoArchive(journey);
    return next ? [next] : [];
  }));
  const [archiveNotice, setArchiveNotice] = useState("");
  const [archiving, setArchiving] = useState(false);
  const revisionRef = useRef(initialPlan.revision);
  const archivingRef = useRef(false);
  const dirtyRef = useRef(false);
  const pendingSaves = useRef(0);
  const editVersion = useRef(0);
  const latest = useRef({ items, title, notes, startDate, dayCount });
  latest.current = { items, title, notes, startDate, dayCount };
  const [saveQueue] = useState(createPlanSaveQueue);
  const draggingItemId = useRef<string | null>(null);
  const movedToDayRef = useRef(false);
  const [dayDropTarget, setDayDropTarget] = useState<number | null>(null);
  const [draggingSchedule, setDraggingSchedule] = useState(false);
  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    if (dirtyRef.current || archivingRef.current) return;
    const version = editVersion.current;
    try {
      const { plan: remote, archives } = await readTripWorkspace();
      if (!isCurrent() || dirtyRef.current || archivingRef.current || version !== editVersion.current) return;
      setArchivedTrips(archives);
      setSyncError("");
      revisionRef.current = remote.revision;
      latest.current = { items: remote.items, title: remote.title, notes: remote.notes, startDate: remote.startDate ?? "", dayCount: remote.dayCount };
      setItems(remote.items); setTitle(remote.title); setNotes(remote.notes);
      setStartDate(remote.startDate ?? ""); setDayCount(remote.dayCount);
      setSelectedDay(day => Math.min(day, Math.max(0, remote.dayCount - 1)));
    } catch {
      if (isCurrent()) setSyncError("파트너의 최신 여행을 불러오지 못했어요. 현재 일정은 그대로 있어요.");
    }
  }, { tables: ["activities"], activityPrefixes: ["TRIP_", "MEMORY_", "PLACE_", "PARTNER_"] });
  useHydratePlanCoordinates("trip", items, setItems);

  const dayItems = useMemo(
    () => itemsForDay(items, selectedDay),
    [items, selectedDay],
  );
  const dayLabel = `DAY ${selectedDay + 1}`;
  const dayDate = startDate ? formatKoDate(addDays(startDate, selectedDay)) : "";

  async function finishTrip() {
    if (!items.length || archivingRef.current) return;
    if (tripSnapshotRecorded(latest.current, archivedTrips)) { setTab("archive"); return; }
    archivingRef.current = true;
    setArchiving(true);
    try {
      await saveQueue.idle();
      const savedResult = await persist(latest.current.items);
      if ("error" in savedResult) return;
      const snapshot = latest.current;
      const result = await archiveTripPlan(snapshot);
      if ("error" in result) { setSaveError(result.error); return; }
      emitCoupleActivitiesChanged();
      setArchivedTrips(current => [{ ...snapshot, id: result.id, status: "completed" }, ...current]);
      setArchiveNotice("둘이 공유하는 지난 여행에 보관했어요.");
      setTab("archive");
      try { setArchivedTrips(await listArchivedTripPlans()); }
      catch { setSyncError("여행은 기록했지만 최신 기록 목록을 불러오지 못했어요."); }
    } catch {
      setSaveError("여행을 보관하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      archivingRef.current = false;
      setArchiving(false);
    }
  }

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number }): Promise<CourseKeepResult> => {
    const snapshot = {
      title: extra?.title ?? latest.current.title,
      subtitle: extra?.subtitle ?? latest.current.notes,
      startDate: extra && "startDate" in extra ? extra.startDate ?? null : latest.current.startDate || null,
      dayCount: extra?.dayCount ?? latest.current.dayCount,
    };
    latest.current = { ...latest.current, items: next, title: snapshot.title, notes: snapshot.subtitle, startDate: snapshot.startDate ?? "", dayCount: snapshot.dayCount };
    const version = ++editVersion.current;
    dirtyRef.current = true;
    pendingSaves.current += 1;
    setSaved(false);
    setSaveError("");
    setItems(next);
    return saveQueue.enqueue(async () => {
      let failure = "";
      try {
        const result = await saveCouplePlan("trip", next, { ...snapshot, expectedRevision: revisionRef.current });
        if ("error" in result) {
          failure = result.error;
          if (editVersion.current === version) setSaveConflict(Boolean(result.conflict));
          return { error: failure };
        }
        revisionRef.current = result.revision;
        emitCoupleActivitiesChanged();
        if (editVersion.current === version) setSaveConflict(false);
        return { ok: true as const };
      } catch {
        failure = "아직 저장되지 않았어요. 연결을 확인하고 다시 시도해 주세요.";
        return { error: failure };
      } finally {
        pendingSaves.current = Math.max(0, pendingSaves.current - 1);
        dirtyRef.current = pendingSaves.current > 0 || Boolean(failure) || editVersion.current !== version;
        if (editVersion.current === version) setSaveError(failure);
        setSaved(!dirtyRef.current);
      }
    });
  };

  const reloadLatest = async () => {
    if (archivingRef.current) return;
    archivingRef.current = true;
    setReloading(true);
    try {
      await saveQueue.idle();
      const remote = await loadCouplePlan("trip");
      revisionRef.current = remote.revision;
      setItems(remote.items); setTitle(remote.title); setNotes(remote.notes);
      setStartDate(remote.startDate ?? ""); setDayCount(remote.dayCount);
      setSelectedDay(day => Math.min(day, Math.max(0, remote.dayCount - 1)));
      dirtyRef.current = false;
      setSaved(true); setSaveConflict(false); setSaveError("");
    } catch {
      setSaveError("최신 여행을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      archivingRef.current = false;
      setReloading(false);
    }
  };

  const apply = (changes: PlanChange[]) => {
    if (archivingRef.current) return;
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
  };

  const replace = (next: PlanItem[]) => {
    if (archivingRef.current) return;
    persist(replacePlanDay(items, selectedDay, next));
  };

  const keepCourse = async (input: CourseKeepInput): Promise<CourseKeepResult> => {
    const inputError = courseKeepError(input);
    if (inputError) return { error: inputError };
    if (archivingRef.current) return { error: "여행을 보관하는 중이에요. 완료 후 다시 담아 주세요." };
    if (input.destination === "trip") {
      setStartDate(input.startDate || "");
      setDayCount(input.dayCount);
      if (input.title) setTitle(input.title);
      const result = await persist(input.items, {
        title: input.title,
        startDate: input.startDate,
        dayCount: input.dayCount,
      });
      if ("error" in result) return result;
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

  const consumeExternalDrop = () => {
    const moved = movedToDayRef.current;
    movedToDayRef.current = false;
    return moved;
  };

  const readDraggedItemId = (event: DragEvent) => {
    const fromType = event.dataTransfer.getData("application/x-plan-item") || event.dataTransfer.getData("text/plain");
    return fromType || draggingItemId.current;
  };

  const dropOnDay = (day: number, event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const itemId = readDraggedItemId(event);
    setDayDropTarget(null);
    setDraggingSchedule(false);
    if (!itemId) return;
    const current = items.find(item => item.id === itemId);
    if (!current || (current.dayIndex ?? 0) === day) return;
    movedToDayRef.current = true;
    persist(movePlanItemToDay(items, itemId, day));
    selectDay(day);
  };

  return (
    <>
      <SyncNotice message={syncError} onRetry={retrySync} />
      {panel === "ai" && (
        <ContextPanel>
          <div inert={archiving || reloading} style={{ display: "contents" }}>
          <AIPlanEditor kind="trip" items={dayItems} startDate={startDate} onApply={apply}
            onReplace={replace} onKeep={keepCourse} candidateExplorationActive={candidateExplorationActive} />
          </div>
        </ContextPanel>
      )}
      <div inert={archiving || reloading} style={{ display: "contents" }}>
      <div className="trip-header">
        <div>
          <span className="eyebrow">{items.length ? `TRIP · ${dayCount} DAYS · ${items.length} PLACES` : "TRIP"}</span>
          {items.length ? (
            <input className="title-input" value={title} disabled={archiving} onChange={event => { dirtyRef.current = true; editVersion.current += 1; setSaved(false); setTitle(event.target.value); }} onBlur={() => void persist(items, { title })} aria-label="여행 제목" />
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
            disabled={archiving}
            onChange={value => {
              setStartDate(value);
              persist(items, { startDate: value || null });
            }}
          />
          <div className={`save-status${saved ? "" : " is-saving"}`} role="status" aria-live="polite"><i /> {saveError || (saved ? "저장됨" : pendingSaves.current > 0 ? "저장 중..." : "아직 저장 전이에요")}</div>
          {saveError && <button className="text-button" type="button" onClick={() => void (saveConflict ? reloadLatest() : persist(latest.current.items))}>{saveConflict ? "최신 일정 불러오기" : "다시 저장"}</button>}
          {items.length > 0 && <button className="outline-button trip-finish-button" type="button" onClick={finishTrip} disabled={archiving || tripSnapshotRecorded(latest.current, archivedTrips)}>{archiving ? "기록하는 중..." : tripSnapshotRecorded(latest.current, archivedTrips) ? "기록된 여행" : "이 여행 기록하기"}</button>}
          <div className="date-action-group">
            <button className={`date-action-button is-history ${panel === "activity" ? "is-active" : ""}`} type="button" onClick={() => setPanel("activity")}>
              <HeaderActionIcon name="activity" /><span>최근 활동</span>
            </button>
            <button className={`date-action-button is-ai ${panel === "ai" ? "is-active" : ""}`} type="button" onClick={() => { setPanel("ai"); openContextPanel(); }}>
              <HeaderActionIcon name="sparkles" /><span>AI로 다듬기</span>
            </button>
          </div>
        </div>
      </div>
      {saveConflict && <p className="form-hint">최신 일정을 불러오면 현재 화면의 미저장 변경을 지우고 파트너가 저장한 일정을 보여 드려요.</p>}
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
            <div className="trip-archive-grid">{archivedTrips.map(journey => <article key={journey.id}><span>{journey.startDate || "날짜 미정"}</span><h3>{journey.title}</h3><p>{journey.dayCount}일 · {journey.items.length}곳</p>{journey.notes && <p style={{ whiteSpace: "pre-wrap" }}>{journey.notes}</p>}<Link href="/our-map">기억 지도에서 보기 →</Link></article>)}</div>
          ) : (
            <p className="form-hint">아직 지난 여행이 없어요. 일정을 마치면 여기에 남아요.</p>
          )}
        </section>
      ) : tab === "notes" ? (
        <section className="plan-notes paper-card">
          <span className="eyebrow">TRIP NOTES</span>
          <h2>둘이 남기는 메모</h2>
          <textarea
            aria-label="여행 노트"
            value={notes}
            disabled={archiving}
            onChange={event => { dirtyRef.current = true; editVersion.current += 1; setSaved(false); setNotes(event.target.value); }}
            onBlur={() => persist(items, { subtitle: notes })}
            placeholder="숙소 체크인, 꼭 먹고 싶은 것, 비 올 때 대안..."
            rows={8}
          />
          <p className="form-hint">포커스를 벗어나면 저장돼요. 파트너도 같은 공간에서 볼 수 있어요.</p>
        </section>
      ) : (
        <div className="planner-shell">
          <aside className={`day-rail${draggingSchedule ? " is-receiving" : ""}`} data-toss-safe>
            <span className="eyebrow">DAYS</span>
            {draggingSchedule && <p className="day-rail-hint" role="status">일정을 다른 날로 옮기세요</p>}
            {Array.from({ length: dayCount }, (_, day) => {
              const count = items.filter(item => (item.dayIndex ?? 0) === day).length;
              const isDropTarget = dayDropTarget === day && selectedDay !== day;
              return (
                <button
                  className={`${selectedDay === day ? "is-active" : ""}${isDropTarget ? " is-drop-target" : ""}`}
                  type="button"
                  key={day}
                  onClick={() => selectDay(day)}
                  onDragEnter={event => {
                    if (!draggingSchedule || selectedDay === day) return;
                    event.preventDefault();
                    setDayDropTarget(day);
                  }}
                  onDragOver={event => {
                    if (!draggingSchedule || selectedDay === day) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dayDropTarget !== day) setDayDropTarget(day);
                  }}
                  onDragLeave={event => {
                    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                    setDayDropTarget(current => (current === day ? null : current));
                  }}
                  onDrop={event => dropOnDay(day, event)}
                  aria-label={draggingSchedule && selectedDay !== day ? `DAY ${day + 1}로 일정 옮기기` : undefined}
                >
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
                <button className="outline-button" type="button" onClick={() => { setPanel("ai"); openContextPanel(); }}>여행 코스 추천받기</button>
                  </div>
                </div>
              ) : (
                <>
                  <PlanTimeline
                    items={dayItems}
                    showTime={false}
                    dayCount={dayCount}
                    onMoveDay={(id, day) => {
                      if (archivingRef.current) return;
                      void persist(movePlanItemToDay(latest.current.items, id, day));
                      selectDay(day);
                    }}
                    onReorder={next => persist(replacePlanDay(items, selectedDay, next))}
                    onUpdate={updateItem}
                    onRemove={id => persist(items.filter(item => item.id !== id))}
                    onDragSessionStart={id => {
                      draggingItemId.current = id;
                      movedToDayRef.current = false;
                      setDraggingSchedule(true);
                    }}
                    onDragSessionEnd={() => {
                      draggingItemId.current = null;
                      setDraggingSchedule(false);
                      setDayDropTarget(null);
                    }}
                    consumeExternalDrop={consumeExternalDrop}
                  />
                  <Link className="add-schedule" href={`/places?from=trip&day=${selectedDay}`}>＋ 이 날에 장소 추가</Link>
                </>
              )}
            </section>
          )}
          {tab === "schedule" && dayItems.length ? <PlanMap items={dayItems} dayLabel={dayLabel} /> : null}
        </div>
      )}
      </div>
    </>
  );
}
