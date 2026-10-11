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
import { archiveTripPlan, listArchivedTripPlans, loadCouplePlan, rescheduleTripPlan, saveCouplePlan, type ArchivedTripPlan } from "@/features/planning/actions";
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
import { hasTripContent, tripDateRange, tripDraftsWithActive, type TripDateSnapshot } from "../tripDates";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import styles from "./TripDateWorkspace.module.css";
import { ExpandableText } from "@/components/shared/ExpandableText";

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
  initialDrafts = [],
  initialArchiveId,
}: {
  initialPlan: CouplePlan;
  initialArchives: ArchivedTripPlan[];
  initialDay?: number;
  candidateExplorationActive?: boolean;
  initialDrafts?: TripDateSnapshot[];
  initialArchiveId?: string;
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
  const [switchingDate, setSwitchingDate] = useState(false);
  const [viewingArchiveId, setViewingArchiveId] = useState(initialArchiveId ?? "");
  const [tripDrafts, setTripDrafts] = useState(initialDrafts);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(plan.startDate ?? "");
  const [allowDateReplace, setAllowDateReplace] = useState(false);
  const [archivedTrips, setArchivedTrips] = useState<ArchivedTripPlan[]>(() => initialArchives.flatMap(journey => {
    const next = stripLegacyDemoArchive(journey);
    return next ? [next] : [];
  }));
  const [archiveNotice, setArchiveNotice] = useState("");
  const [archiving, setArchiving] = useState(false);
  const revisionRef = useRef(initialPlan.revision);
  const archivingRef = useRef(false);
  const switchingRef = useRef(false);
  const archiveViewRef = useRef(initialArchiveId ?? "");
  const dirtyRef = useRef(false);
  const pendingSaves = useRef(0);
  const editVersion = useRef(0);
  const latest = useRef({ items, title, notes, startDate, dayCount });
  latest.current = { items, title, notes, startDate, dayCount };
  const rescheduleDialogRef = useDialogFocus<HTMLFormElement>({ open: rescheduleOpen, onClose: () => { if (!switchingRef.current) setRescheduleOpen(false); } });
  const [saveQueue] = useState(createPlanSaveQueue);
  const draggingItemId = useRef<string | null>(null);
  const movedToDayRef = useRef(false);
  const [dayDropTarget, setDayDropTarget] = useState<number | null>(null);
  const [draggingSchedule, setDraggingSchedule] = useState(false);
  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    if (dirtyRef.current || archivingRef.current || switchingRef.current) return;
    const version = editVersion.current;
    try {
      const { plan: remote, archives, drafts } = await readTripWorkspace(latest.current.startDate || null);
      if (!isCurrent() || dirtyRef.current || archivingRef.current || switchingRef.current || version !== editVersion.current) return;
      setArchivedTrips(archives);
      setTripDrafts(drafts);
      setSyncError("");
      revisionRef.current = remote.revision;
      if (archiveViewRef.current) return;
      latest.current = { items: remote.items, title: remote.title, notes: remote.notes, startDate: remote.startDate ?? "", dayCount: remote.dayCount };
      setItems(remote.items); setTitle(remote.title); setNotes(remote.notes);
      setStartDate(remote.startDate ?? ""); setDayCount(remote.dayCount);
      setSelectedDay(day => Math.min(day, Math.max(0, remote.dayCount - 1)));
    } catch {
      if (isCurrent()) setSyncError("파트너의 최신 여행을 불러오지 못했어요. 현재 일정은 그대로 있어요.");
    }
  }, { tables: ["activities", "trip_drafts"], activityPrefixes: ["TRIP_", "MEMORY_", "PLACE_", "PARTNER_"] });
  useHydratePlanCoordinates("trip", viewingArchiveId ? [] : items, setItems);

  const dayItems = useMemo(
    () => itemsForDay(items, selectedDay),
    [items, selectedDay],
  );
  const dayLabel = `DAY ${selectedDay + 1}`;
  const dayDate = startDate ? formatKoDate(addDays(startDate, selectedDay)) : "";
  const rescheduleTarget = tripDrafts.find(draft => draft.startDate === rescheduleDate && draft.startDate !== startDate);

  async function finishTrip() {
    if (!items.length || archivingRef.current || switchingRef.current || archiveViewRef.current) return;
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

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number }, internalFlush = false): Promise<CourseKeepResult> => {
    if (archiveViewRef.current || switchingRef.current && !internalFlush) return Promise.resolve({ error: "여행을 조회하는 중에는 저장하지 않아요. 조회가 끝난 뒤 다시 수정해 주세요." });
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
        setTripDrafts(current => tripDraftsWithActive(current, { persist: true, revision: result.revision, title: snapshot.title,
          notes: snapshot.subtitle, startDate: snapshot.startDate, dayCount: snapshot.dayCount, items: next }));
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

  function applyTrip(remote: CouplePlan, archiveId = "", day = 0) {
    editVersion.current += 1;
    revisionRef.current = remote.revision;
    latest.current = { items: remote.items, title: remote.title || "우리가 고른 여행", notes: remote.notes,
      startDate: remote.startDate ?? "", dayCount: remote.dayCount };
    setItems(remote.items); setTitle(latest.current.title); setNotes(remote.notes);
    setStartDate(remote.startDate ?? ""); setDayCount(remote.dayCount);
    setSelectedDay(Math.max(0, Math.min(day, Math.max(0, remote.dayCount - 1))));
    archiveViewRef.current = archiveId;
    setViewingArchiveId(archiveId);
    dirtyRef.current = false;
    setSaved(true); setSaveConflict(false); setSaveError("");
    setTab("schedule");
  }

  async function flushEdits() {
    await saveQueue.idle();
    if (!dirtyRef.current) return true;
    const result = await persist(latest.current.items, undefined, true);
    return !("error" in result);
  }

  async function switchDate(nextDate: string) {
    if (nextDate === latest.current.startDate && !archiveViewRef.current || switchingRef.current || archivingRef.current) return;
    switchingRef.current = true;
    setSwitchingDate(true);
    setSaveError(""); setSyncError("");
    try {
      if (!archiveViewRef.current && !await flushEdits()) return;
      const remote = await readTripWorkspace(nextDate || null);
      setArchivedTrips(remote.archives); setTripDrafts(remote.drafts);
      applyTrip(remote.plan);
      // Replace the query without a navigation/remount that could replay a stale
      // initial server snapshot after the next edit starts.
      window.history.replaceState(null, "", nextDate ? `/trip?date=${nextDate}` : "/trip?date=");
    } catch {
      setSyncError("선택한 날짜의 여행을 불러오지 못했어요. 현재 여행은 그대로 있어요. 날짜를 다시 선택해 주세요.");
    } finally {
      switchingRef.current = false;
      setSwitchingDate(false);
    }
  }

  async function openArchive(journey: ArchivedTripPlan, day = 0) {
    if (switchingRef.current || archivingRef.current) return;
    switchingRef.current = true; setSwitchingDate(true);
    try {
      if (!archiveViewRef.current && !await flushEdits()) return;
      applyTrip({ persist: plan.persist, revision: revisionRef.current, ...journey, notes: journey.notes ?? "" }, journey.id, day);
      window.history.replaceState(null, "", `/trip?archive=${encodeURIComponent(journey.id)}&day=${day}`);
    } finally { switchingRef.current = false; setSwitchingDate(false); }
  }

  async function reschedule() {
    if (switchingRef.current || archivingRef.current || archiveViewRef.current || !rescheduleDate
      || rescheduleTarget && !allowDateReplace) return;
    switchingRef.current = true; setSwitchingDate(true); setSaveError("");
    try {
      if (!await flushEdits()) return;
      // The viewed date can be a saved draft. Explicitly activate its latest
      // snapshot before the atomic date move; browsing itself never does this.
      const savedResult = await persist(latest.current.items, undefined, true);
      if ("error" in savedResult) return;
      const result = await rescheduleTripPlan({ startDate: rescheduleDate, expectedRevision: revisionRef.current,
        expectedTargetUpdatedAt: allowDateReplace ? rescheduleTarget?.updatedAt : undefined });
      if ("error" in result) { setSaveError(result.error); setSaveConflict(Boolean(result.conflict)); return; }
      const previousDate = latest.current.startDate;
      applyTrip({ persist: true, revision: result.revision, ...latest.current, startDate: rescheduleDate });
      setTripDrafts(current => tripDraftsWithActive(current.filter(trip => trip.startDate !== previousDate), {
        persist: true, revision: result.revision, ...latest.current, startDate: rescheduleDate,
      }));
      setRescheduleOpen(false); setAllowDateReplace(false);
      emitCoupleActivitiesChanged();
      window.history.replaceState(null, "", `/trip?date=${rescheduleDate}`);
      try {
        const remote = await readTripWorkspace(rescheduleDate);
        applyTrip(remote.plan); setTripDrafts(remote.drafts); setArchivedTrips(remote.archives);
      } catch { setSyncError("날짜는 변경됐지만 최신 목록을 불러오지 못했어요. 변경된 여행은 그대로 있어요."); }
    } catch { setSaveError("여행 날짜를 바꾸지 못했어요. 최신 여행을 확인한 뒤 다시 시도해 주세요."); }
    finally { switchingRef.current = false; setSwitchingDate(false); }
  }

  const reloadLatest = async () => {
    if (archivingRef.current || switchingRef.current) return;
    archivingRef.current = true;
    setReloading(true);
    try {
      await saveQueue.idle();
      const remote = await loadCouplePlan("trip");
      applyTrip(remote);
      window.history.replaceState(null, "", "/trip");
    } catch {
      setSaveError("최신 여행을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      archivingRef.current = false;
      setReloading(false);
    }
  };

  const apply = (changes: PlanChange[]) => {
    if (archivingRef.current || switchingRef.current || archiveViewRef.current) return;
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
  };

  const replace = (next: PlanItem[]) => {
    if (archivingRef.current || switchingRef.current || archiveViewRef.current) return;
    persist(replacePlanDay(items, selectedDay, next));
  };

  const keepCourse = async (input: CourseKeepInput): Promise<CourseKeepResult> => {
    const inputError = courseKeepError(input);
    if (inputError) return { error: inputError };
    if (archivingRef.current || switchingRef.current || archiveViewRef.current) return { error: "여행을 조회하거나 기록하는 중이에요. 현재 여행에서 다시 담아 주세요." };
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
    if (archivingRef.current || switchingRef.current || archiveViewRef.current) return;
    persist(items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const selectDay = (day: number) => {
    setSelectedDay(day);
  };

  const addDay = () => {
    if (dayCount >= 7 || archivingRef.current || switchingRef.current || archiveViewRef.current) return;
    const nextCount = dayCount + 1;
    setDayCount(nextCount);
    selectDay(dayCount);
    persist(items, { dayCount: nextCount });
  };

  const removeLastDay = () => {
    if (dayCount <= 1 || archivingRef.current || switchingRef.current || archiveViewRef.current) return;
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
    if (archivingRef.current || switchingRef.current || archiveViewRef.current) return;
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
          <div inert={archiving || reloading || switchingDate || Boolean(viewingArchiveId)} style={{ display: "contents" }}>
          <AIPlanEditor kind="trip" items={dayItems} startDate={startDate} onApply={apply}
            onReplace={replace} onKeep={keepCourse} candidateExplorationActive={candidateExplorationActive} />
          </div>
        </ContextPanel>
      )}
      <div inert={archiving || reloading || switchingDate} style={{ display: "contents" }}>
      <div className="trip-header">
        <div>
          <span className="eyebrow">{items.length ? `TRIP · ${dayCount} DAYS · ${items.length} PLACES` : "TRIP"}</span>
          {items.length ? (
            <input className="title-input" value={title} readOnly={Boolean(viewingArchiveId)} disabled={archiving || switchingDate} onChange={event => { if (archiveViewRef.current) return; dirtyRef.current = true; editVersion.current += 1; latest.current.title = event.target.value; setSaved(false); setTitle(event.target.value); }} onBlur={() => { if (!archiveViewRef.current && !switchingRef.current && dirtyRef.current && pendingSaves.current === 0) void persist(latest.current.items); }} aria-label="여행 제목" />
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
            emptyLabel="여행 날짜 둘러보기"
            ariaLabel="여행 날짜 조회"
            clearLabel="날짜 미정 여행 보기"
            markedDates={tripDrafts.map(draft => draft.startDate).filter(Boolean)}
            markedLabels={Object.fromEntries(tripDrafts.filter(draft => draft.startDate).map(draft => [draft.startDate, draft.title]))}
            markedHint="색이 있는 날은 저장한 여행의 시작일이에요. 날짜를 고르면 그 여행을 조회해요."
            disabled={archiving || switchingDate}
            onChange={value => void switchDate(value)}
          />
          {!viewingArchiveId && items.length > 0 && <button className="outline-button" type="button" disabled={archiving || switchingDate} onClick={() => { setRescheduleDate(startDate); setAllowDateReplace(false); setRescheduleOpen(true); }}>여행 날짜 변경</button>}
          <div className={`save-status${saved && !switchingDate ? "" : " is-saving"}`} role="status" aria-live="polite"><i /> {saveError || (switchingDate ? "여행 불러오는 중…" : viewingArchiveId ? "저장된 여행기록 · 읽기 전용" : saved ? hasTripContent(latest.current) ? "저장됨" : "조회 완료 · 일정 없음" : pendingSaves.current > 0 ? "저장 중..." : "아직 저장 전이에요")}</div>
          {saveError && <button className="text-button" type="button" onClick={() => void (saveConflict ? reloadLatest() : persist(latest.current.items))}>{saveConflict ? "최신 일정 불러오기" : "다시 저장"}</button>}
          {!viewingArchiveId && items.length > 0 && <button className="outline-button trip-finish-button" type="button" onClick={finishTrip} disabled={archiving || switchingDate || tripSnapshotRecorded(latest.current, archivedTrips)}>{archiving ? "여행기록 저장 중…" : tripSnapshotRecorded(latest.current, archivedTrips) ? "기록된 여행" : "여행기록 저장"}</button>}
          <div className="date-action-group">
            <button className={`date-action-button is-history ${panel === "activity" ? "is-active" : ""}`} type="button" onClick={() => setPanel("activity")}>
              <HeaderActionIcon name="activity" /><span>최근 활동</span>
            </button>
            <button disabled={Boolean(viewingArchiveId)} className={`date-action-button is-ai ${panel === "ai" ? "is-active" : ""}`} type="button" onClick={() => { setPanel("ai"); openContextPanel(); }}>
              <HeaderActionIcon name="sparkles" /><span>AI로 다듬기</span>
            </button>
          </div>
        </div>
      </div>
      {!viewingArchiveId && <p className="form-hint">날짜를 고르면 해당 날짜의 여행을 조회해요. 현재 코스를 옮기려면 ‘여행 날짜 변경’을 선택해 주세요.</p>}
      {viewingArchiveId && <div className={styles.archiveBanner}><span>저장한 여행기록을 보고 있어요. 일정과 메모는 기록 당시 모습으로 남아 있어요.</span><button type="button" onClick={() => void reloadLatest()}>현재 여행으로 돌아가기</button></div>}
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
            <div className="trip-archive-grid">{archivedTrips.map(journey => <article key={journey.id}><span>{tripDateRange(journey.startDate, journey.dayCount)}</span><h3>{journey.title}</h3><p>{journey.dayCount}일 · {journey.items.length}곳</p>{journey.notes && <p style={{ whiteSpace: "pre-wrap" }}>{journey.notes}</p>}<button className="text-link" type="button" onClick={() => void openArchive(journey)}>여행기록 열기 →</button><Link href="/our-map">기억 지도에서 보기 →</Link></article>)}</div>
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
            readOnly={Boolean(viewingArchiveId)} disabled={archiving || switchingDate}
            onChange={event => { if (archiveViewRef.current) return; dirtyRef.current = true; editVersion.current += 1; latest.current.notes = event.target.value; setSaved(false); setNotes(event.target.value); }}
            onBlur={() => { if (!archiveViewRef.current && !switchingRef.current && dirtyRef.current && pendingSaves.current === 0) void persist(latest.current.items); }}
            placeholder="숙소 체크인, 꼭 먹고 싶은 것, 비 올 때 대안..."
            rows={8}
          />
          <p className="form-hint">{viewingArchiveId ? "기록 당시 남긴 여행 노트예요." : "포커스를 벗어나면 저장돼요. 파트너도 같은 공간에서 볼 수 있어요."}</p>
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
            {!viewingArchiveId && dayCount < 7 && <button className="add-day" type="button" onClick={addDay}>하루 추가</button>}
            {!viewingArchiveId && dayCount > 1 && !items.some(item => (item.dayIndex ?? 0) === dayCount - 1) && (
              <button className="add-day" type="button" onClick={removeLastDay}>빈 하루 빼기</button>
            )}
            <div className="trip-note">너무 많이 말고,<br />좋아하는 곳에 오래.</div>
          </aside>
          {tab === "map" ? (
            dayItems.length ? <PlanMap items={dayItems} dayLabel={dayLabel} expanded /> : (
              <div className="empty-soft planner-empty">
                <h2>이 날에 올릴 장소가 없어요</h2>
                <p>{viewingArchiveId ? "이 날짜에는 기록된 장소가 없어요." : "일정에 장소를 담으면 여기서 순서를 보여 줘요."}</p>
                {!viewingArchiveId && <Link className="primary-button" href={`/places?from=trip&day=${selectedDay}&tripDate=${startDate}`}>이 날의 장소 찾기</Link>}
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
                  <h2>{items.length ? "이날은 비어 있어요" : "여행 초안이 비어 있어요"}</h2>
                  <p>{viewingArchiveId ? "이 날짜에는 기록된 장소가 없어요. 다른 여행 날짜를 골라 기록을 확인해 보세요." : "함께 가고 싶은 장소를 이 날짜에 담아 보세요. AI에게 하루 코스를 추천받을 수도 있어요."}</p>
                  {!viewingArchiveId && <div className="dialog-actions">
                <Link className="primary-button" href={`/places?from=trip&day=${selectedDay}&tripDate=${startDate}`}>이 날의 장소 찾기</Link>
                <button className="outline-button" type="button" onClick={() => { setPanel("ai"); openContextPanel(); }}>여행 코스 추천받기</button>
                  </div>}
                </div>
              ) : (
                <>
                  {viewingArchiveId ? <ol className={styles.recordAgenda} aria-label="저장된 여행의 장소 순서">{dayItems.map((item, index) => <li key={item.id}><span>{index + 1}</span><div><small>{item.category}</small><h3>{item.placeName}</h3>{item.memo && <ExpandableText text={item.memo} className={styles.recordMemo} label={`${item.placeName} 메모`} />}</div></li>)}</ol> : <PlanTimeline
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
                  />}
                  {!viewingArchiveId && <Link className="add-schedule" href={`/places?from=trip&day=${selectedDay}&tripDate=${startDate}`}>＋ 이 날에 장소 추가</Link>}
                </>
              )}
            </section>
          )}
          {tab === "schedule" && dayItems.length ? <PlanMap items={dayItems} dayLabel={dayLabel} /> : null}
        </div>
      )}
      </div>
      {rescheduleOpen && <div className="dialog-backdrop" onClick={event => { if (event.target === event.currentTarget && !switchingRef.current) setRescheduleOpen(false); }}>
        <form ref={rescheduleDialogRef} tabIndex={-1} className={`place-create-dialog ${styles.rescheduleDialog}`} role="dialog" aria-modal="true" aria-labelledby="trip-reschedule-title" onSubmit={event => { event.preventDefault(); void reschedule(); }}>
          <div className="dialog-head"><h2 id="trip-reschedule-title">이 여행의 날짜를 바꿀까요?</h2><button type="button" className="icon-button" disabled={switchingDate} aria-label="닫기" onClick={() => setRescheduleOpen(false)}>×</button></div>
          <p>장소 순서와 여행 노트를 유지한 채 시작일을 옮겨요. 원래 날짜의 여행 초안은 새 날짜로 이동해요. 저장한 여행기록은 그대로 남아요.</p>
          <label className="field"><span>새 여행 시작일</span><input data-dialog-autofocus type="date" value={rescheduleDate} required disabled={switchingDate} onChange={event => { setRescheduleDate(event.target.value); setAllowDateReplace(false); }} /></label>
          {rescheduleTarget && <div className={styles.targetWarning}><b>{rescheduleTarget.title}</b><p>이 날짜에 {rescheduleTarget.items.length}곳을 담은 여행이 있어요.</p><label><input type="checkbox" checked={allowDateReplace} disabled={switchingDate} onChange={event => setAllowDateReplace(event.target.checked)} />확인한 여행을 현재 코스로 교체할게요.</label></div>}
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          <div className="dialog-actions"><button className="outline-button" type="button" disabled={switchingDate} onClick={() => setRescheduleOpen(false)}>취소</button><button className="primary-button" type="submit" disabled={switchingDate || !rescheduleDate || rescheduleDate === startDate || Boolean(rescheduleTarget && !allowDateReplace)}>{switchingDate ? "날짜 변경 중…" : "확인하고 날짜 변경"}</button></div>
        </form>
      </div>}
    </>
  );
}
