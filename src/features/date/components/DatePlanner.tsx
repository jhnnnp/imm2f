"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AppLink as Link } from "@/components/layout/AppLink";
import { useRouter } from "next/navigation";
import { readDateWorkspace } from "@/features/collaboration/workspaceReads";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { openContextPanel } from "@/components/layout/ContextPanelDrawer";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import { ExpandableText } from "@/components/shared/ExpandableText";
import { DateArchiveJournal } from "@/features/date/components/DateArchiveJournal";
import { DateTripPlans } from "@/features/date/components/DateTripPlans";
import { emptyDateDay, hasDateContent, upsertDateDay, type DateDaySnapshot } from "@/features/date/dateDays";
import type { TripDayPlan } from "@/features/date/tripDayPlans";
import { courseKeepError, type CourseKeepInput, type CourseKeepResult } from "@/features/ai/courseKeep";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import { archiveDatePlan, listArchivedDatePlans, loadCouplePlan, openDateDay, saveCouplePlan, saveDateDraft, type ArchivedDatePlan } from "@/features/planning/actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import type { CouplePlan, PlanChange, PlanItem } from "@/features/planning/types/plan";
import type { TasteDateSeed } from "@/features/taste/types";
import { addDays, formatKoDate, isIsoDate, seoulTodayIso } from "@/lib/dates";
import { createPlanSaveQueue } from "@/features/planning/saveQueue";
import { SyncNotice } from "@/components/shared/SyncNotice";
import styles from "./DatePlanner.module.css";

const AIPlanEditor = dynamic(
  () => import("@/features/ai/components/AIPlanEditor").then(mod => mod.AIPlanEditor),
  { ssr: false, loading: () => <div className="panel-loading" aria-label="AI 플래너 불러오는 중"><i /><i /><i /></div> },
);

type Panel = "ai" | null;

function viewDateDay(plan: CouplePlan, savedDrafts: DateDaySnapshot[], selectedDate: string) {
  const current: DateDaySnapshot = { date: plan.startDate || "", title: plan.title || "우리가 고른 데이트", notes: plan.notes, items: plan.items };
  // An empty legacy active row may coexist with the saved day. Viewing it must
  // keep that saved snapshot, as the existing Date landing flow did.
  const drafts = current.date && hasDateContent(current) ? upsertDateDay(savedDrafts, current) : savedDrafts;
  const undated = current.date ? emptyDateDay("") : current;
  return {
    drafts,
    undated,
    focus: selectedDate ? drafts.find(day => day.date === selectedDate) ?? emptyDateDay(selectedDate) : undated,
  };
}

function replaceViewedDate(date: string) {
  window.history.replaceState(null, "", `/date?day=${date}`);
}

export function DatePlanner({
  initialPlan,
  initialArchives,
  initialDrafts = [],
  initialTripDays = [],
  initialTripSyncError = "",
  today,
  tasteSeed = null,
  candidateExplorationActive = false,
}: {
  initialPlan: CouplePlan;
  initialArchives: ArchivedDatePlan[];
  initialDrafts?: DateDaySnapshot[];
  initialTripDays?: TripDayPlan[];
  initialTripSyncError?: string;
  today: string;
  tasteSeed?: TasteDateSeed | null;
  candidateExplorationActive?: boolean;
}) {
  const [landed] = useState(() => viewDateDay(initialPlan, initialDrafts, today));
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(landed.focus.items);
  const [title, setTitle] = useState(landed.focus.title || "우리가 고른 데이트");
  const [notes, setNotes] = useState(landed.focus.notes);
  const [startDate, setStartDate] = useState(landed.focus.date);
  const [drafts, setDrafts] = useState<DateDaySnapshot[]>(landed.drafts);
  const [tripDays, setTripDays] = useState<TripDayPlan[]>(initialTripDays);
  const [tripSyncError, setTripSyncError] = useState(initialTripSyncError);
  const [hasStoredUndated, setHasStoredUndated] = useState(hasDateContent(landed.undated));
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDate, setAssignDate] = useState(today || seoulTodayIso());
  const [allowDateReplace, setAllowDateReplace] = useState(false);
  const [panel, setPanel] = useState<Panel>(tasteSeed ? "ai" : null);
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [notesSaveState, setNotesSaveState] = useState<"saved" | "typing" | "saving" | "error">("saved");
  const [showArchive, setShowArchive] = useState(false);
  const [archivedDates, setArchivedDates] = useState<ArchivedDatePlan[]>(initialArchives);
  const [archiveNotice, setArchiveNotice] = useState("");
  const [archiveFocusId, setArchiveFocusId] = useState("");
  const [recording, setRecording] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const pendingArchiveRef = useRef<{ archive: ArchivedDatePlan; next: DateDaySnapshot; remaining: DateDaySnapshot[] } | null>(null);
  const [switchingDate, setSwitchingDate] = useState(false);
  const revisionRef = useRef(initialPlan.revision);
  const dirtyRef = useRef(false);
  const unsavedTextRef = useRef(false);
  const pendingSaves = useRef(0);
  const [saveQueue] = useState(createPlanSaveQueue);
  const switchingRef = useRef(false);
  const recordingRef = useRef(false);
  const preservePreviousDateRef = useRef(true);
  const editVersion = useRef(0);
  const itemsRef = useRef(items);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const notesRef = useRef(notes);
  const dateRef = useRef(startDate);
  const draftsRef = useRef(drafts);
  const undatedRef = useRef(landed.undated);
  const storedUndatedRef = useRef(hasStoredUndated);
  titleRef.current = title;
  notesRef.current = notes;
  dateRef.current = startDate;
  itemsRef.current = items;
  draftsRef.current = drafts;
  const assignDialogRef = useDialogFocus<HTMLFormElement>({ open: assignOpen, onClose: () => { if (!switchingRef.current) setAssignOpen(false); } });

  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    if (dirtyRef.current || switchingRef.current || recordingRef.current || pendingArchiveRef.current) return;
    const version = editVersion.current;
    try {
      const { plan: remote, drafts: nextDrafts, archives, tripDays: nextTripDays, tripSyncError: nextTripError } = await readDateWorkspace();
      if (!isCurrent() || dirtyRef.current || switchingRef.current || recordingRef.current || pendingArchiveRef.current || version !== editVersion.current) return;
      revisionRef.current = remote.revision;
      const next = viewDateDay(remote, nextDrafts, dateRef.current);
      updateUndated(next.undated);
      applyFocus(next.focus, next.drafts, false);
      setArchivedDates(archives);
      if (nextTripDays) setTripDays(nextTripDays);
      setTripSyncError(nextTripError);
      setSyncError("");
    } catch {
      if (isCurrent()) setSyncError("파트너의 최신 데이트를 불러오지 못했어요. 현재 일정은 그대로 있어요.");
    }
  }, { tables: ["activities", "trip_drafts"], activityPrefixes: ["DATE_", "TRIP_", "MEMORY_", "PLACE_", "PARTNER_"] });


  useEffect(() => {
    return () => {
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
  }, []);

  const upcoming = useMemo(
    () => drafts.filter(day => hasDateContent(day)),
    [drafts],
  );
  const viewedTripDays = useMemo(() => startDate ? tripDays.filter(day => addDays(day.startDate, day.dayIndex) === startDate) : [], [tripDays, startDate]);
  const hasOwnDate = hasDateContent({ title, notes, items });
  const isTripOnly = viewedTripDays.length > 0 && !hasOwnDate;
  const markedDates = useMemo(() => [...new Set([...upcoming.map(day => day.date), ...tripDays.map(day => addDays(day.startDate, day.dayIndex))])], [upcoming, tripDays]);
  const placesHref = `/places?from=date&day=${startDate}`;
  const markedLabels = useMemo(
    () => {
      const labels: Record<string, string[]> = {};
      upcoming.forEach(day => { labels[day.date] = [`${day.items[0]?.placeName || "데이트"}${day.items.length > 1 ? ` 외 ${day.items.length - 1}곳` : ""}`]; });
      tripDays.forEach(day => {
        const date = addDays(day.startDate, day.dayIndex);
        (labels[date] ??= []).push(`${day.title || "여행"} · DAY ${day.dayIndex + 1}`);
      });
      return Object.fromEntries(Object.entries(labels).map(([date, values]) => [date, values.join(" / ")]));
    },
    [upcoming, tripDays],
  );
  const assignTarget = drafts.find(day => day.date === assignDate && hasDateContent(day));
  useEffect(() => {
    if (assignOpen) setAllowDateReplace(false);
  }, [assignOpen, assignDate, assignTarget]);

  const updateUndated = (snapshot: DateDaySnapshot) => {
    undatedRef.current = snapshot;
    storedUndatedRef.current = hasDateContent(snapshot);
    setHasStoredUndated(storedUndatedRef.current);
  };

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null; preservePreviousDate?: boolean }, internalFlush = false): Promise<CourseKeepResult> => {
    if (switchingRef.current && !internalFlush) return Promise.resolve({ error: "날짜 일정을 불러오는 중이에요. 잠시 후 다시 저장해 주세요." });
    const nextDate = extra && "startDate" in extra ? extra.startDate ?? "" : dateRef.current;
    if (nextDate && storedUndatedRef.current && extra?.preservePreviousDate !== false) {
      const error = "날짜 미정 코스를 먼저 날짜에 배정해 주세요. 기존 코스를 보관한 뒤 이 날짜의 데이트를 저장할 수 있어요.";
      setSaveError(error);
      setNotesSaveState("error");
      return Promise.resolve({ error });
    }
    const version = ++editVersion.current;
    dirtyRef.current = true;
    unsavedTextRef.current = false;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    pendingSaves.current += 1;
    const mapped = next.map(item => ({ ...item, dayIndex: item.dayIndex ?? 0 }));
    const nextTitle = extra?.title ?? titleRef.current;
    const nextNotes = extra && "subtitle" in extra ? extra.subtitle ?? "" : notesRef.current;
    const preservePreviousDate = extra?.preservePreviousDate ?? preservePreviousDateRef.current;
    preservePreviousDateRef.current = preservePreviousDate;
    itemsRef.current = mapped;
    if (extra?.title !== undefined) { titleRef.current = nextTitle; setTitle(nextTitle); }
    if (extra && "subtitle" in extra) { notesRef.current = nextNotes; setNotes(nextNotes); }
    if (extra && "startDate" in extra) { dateRef.current = nextDate; setStartDate(nextDate); }
    setItems(mapped);
    setSaveError("");
    setNotesSaveState("saving");
    if (nextDate) {
      draftsRef.current = upsertDateDay(draftsRef.current, { date: nextDate, title: nextTitle, notes: nextNotes, items: mapped });
      setDrafts(draftsRef.current);
    }
    return saveQueue.enqueue(async () => {
      let failure = "";
      try {
        const result = await saveCouplePlan("date", mapped, {
          title: nextTitle,
          subtitle: nextNotes,
          startDate: nextDate || null,
          dayCount: Math.max(1, ...mapped.map(item => (item.dayIndex ?? 0) + 1)),
          expectedRevision: revisionRef.current,
          preservePreviousDate,
        });
        if ("error" in result) {
          failure = result.error;
          if (editVersion.current === version) setSaveConflict(Boolean(result.conflict));
          return { error: failure };
        }
        revisionRef.current = result.revision;
        if (!nextDate) updateUndated({ date: "", title: nextTitle, notes: nextNotes, items: mapped });
        if (nextDate) {
          const draftResult = await saveDateDraft({ date: nextDate, title: nextTitle, notes: nextNotes, items: mapped });
          if ("error" in draftResult) {
            failure = draftResult.error;
            return { error: failure };
          }
        }
        emitCoupleActivitiesChanged();
        preservePreviousDateRef.current = true;
        if (editVersion.current === version) setSaveConflict(false);
        return { ok: true as const };
      } catch {
        failure = "아직 저장되지 않았어요. 연결을 확인하고 다시 시도해 주세요.";
        return { error: failure };
      } finally {
        pendingSaves.current = Math.max(0, pendingSaves.current - 1);
        dirtyRef.current = pendingSaves.current > 0 || Boolean(failure) || editVersion.current !== version;
        if (editVersion.current === version) setSaveError(failure);
        setNotesSaveState(pendingSaves.current > 0 ? "saving" : editVersion.current !== version ? "typing" : failure ? "error" : "saved");
      }
    });
  };

  const applyFocus = (focus: DateDaySnapshot, nextDrafts: DateDaySnapshot[], closeArchive = true) => {
    titleRef.current = focus.title;
    notesRef.current = focus.notes;
    dateRef.current = focus.date;
    itemsRef.current = focus.items;
    unsavedTextRef.current = false;
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    setStartDate(focus.date);
    setTitle(focus.title);
    setNotes(focus.notes);
    setItems(focus.items);
    if (closeArchive) setShowArchive(false);
  };

  const switchDate = async (nextDate: string) => {
    if (nextDate === dateRef.current || switchingRef.current || recordingRef.current || pendingArchiveRef.current) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    switchingRef.current = true;
    setSwitchingDate(true);
    try {
      await saveQueue.idle();
      if (dirtyRef.current) {
        const saved = await persist(itemsRef.current, undefined, true);
        if ("error" in saved) return;
      }
      const current: DateDaySnapshot = { date: dateRef.current, title: titleRef.current, notes: notesRef.current, items: itemsRef.current };
      const nextDrafts = current.date ? upsertDateDay(draftsRef.current, current) : draftsRef.current;
      if (!current.date) undatedRef.current = current;
      const focus = nextDate ? nextDrafts.find(day => day.date === nextDate) ?? emptyDateDay(nextDate) : undatedRef.current;
      editVersion.current += 1;
      dirtyRef.current = false;
      applyFocus(focus, nextDrafts);
      setSaveError("");
      setNotesSaveState("saved");
      setSaveConflict(false);
      replaceViewedDate(focus.date);
    } catch {
      setSaveError("날짜의 일정을 열지 못했어요. 현재 일정은 그대로 있으니 다시 시도해 주세요.");
      setNotesSaveState("error");
    } finally {
      switchingRef.current = false;
      setSwitchingDate(false);
    }
  };

  const openAssignDate = () => {
    if (dateRef.current || switchingRef.current || recordingRef.current || pendingArchiveRef.current) return;
    setAssignDate(today || seoulTodayIso());
    setAllowDateReplace(false);
    setAssignOpen(true);
  };

  const assignUndatedDate = async () => {
    if (dateRef.current || !isIsoDate(assignDate) || switchingRef.current || recordingRef.current || pendingArchiveRef.current || (assignTarget && !allowDateReplace)) return;
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    switchingRef.current = true;
    setSwitchingDate(true);
    setSaveError("");
    try {
      await saveQueue.idle();
      if (dirtyRef.current) {
        const saved = await persist(itemsRef.current, undefined, true);
        if ("error" in saved) return;
      }
      const result = await openDateDay({
        fromDate: null,
        toDate: assignDate,
        snapshot: { title: titleRef.current, notes: notesRef.current, items: itemsRef.current },
        expectedRevision: revisionRef.current,
        expectedTargetSnapshot: assignTarget ?? null,
      });
      if ("error" in result) {
        setSaveError(result.error);
        setSaveConflict(Boolean(result.conflict));
        setNotesSaveState("error");
        return;
      }
      revisionRef.current = result.revision;
      editVersion.current += 1;
      dirtyRef.current = false;
      updateUndated(emptyDateDay(""));
      applyFocus(result.focus, result.drafts);
      setAssignOpen(false);
      setNotesSaveState("saved");
      setSaveConflict(false);
      replaceViewedDate(result.focus.date);
      emitCoupleActivitiesChanged();
    } catch {
      setSaveError("날짜를 지정하지 못했어요. 날짜 미정 코스는 그대로 있으니 다시 시도해 주세요.");
      setNotesSaveState("error");
    } finally {
      switchingRef.current = false;
      setSwitchingDate(false);
    }
  };

  const reloadLatest = async () => {
    if (switchingRef.current || recordingRef.current || pendingArchiveRef.current) return;
    switchingRef.current = true;
    setSwitchingDate(true);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    try {
      await saveQueue.idle();
      const { plan, drafts: latestDrafts, tripDays: nextTripDays, tripSyncError: nextTripError, archives } = await readDateWorkspace();
      const next = viewDateDay(plan, latestDrafts, dateRef.current);
      revisionRef.current = plan.revision;
      updateUndated(next.undated);
      applyFocus(next.focus, next.drafts);
      if (nextTripDays) setTripDays(nextTripDays);
      setTripSyncError(nextTripError);
      setArchivedDates(archives);
      dirtyRef.current = false;
      setSaveError("");
      setSaveConflict(false);
      setNotesSaveState("saved");
    } catch {
      setSaveError("최신 일정을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      switchingRef.current = false;
      setSwitchingDate(false);
    }
  };

  const apply = (changes: PlanChange[]) => {
    if (switchingRef.current || recordingRef.current || pendingArchiveRef.current) return;
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
  };

  const saveNotes = (value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    return persist(itemsRef.current, { subtitle: value });
  };

  const scheduleNotesSave = (value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    dirtyRef.current = true;
    unsavedTextRef.current = true;
    editVersion.current += 1;
    notesRef.current = value;
    setNotesSaveState("typing");
    notesTimerRef.current = setTimeout(() => saveNotes(value), 800);
  };

  const replace = (next: PlanItem[]) => {
    if (switchingRef.current || recordingRef.current || pendingArchiveRef.current) return;
    persist(next);
  };

  const keepCourse = async (input: CourseKeepInput): Promise<CourseKeepResult> => {
    const inputError = courseKeepError(input);
    if (inputError) return { error: inputError };
    if (switchingRef.current || recordingRef.current || pendingArchiveRef.current) return { error: "일정을 정리하는 중이에요. 완료 후 다시 담아 주세요." };
    if (input.destination === "date") {
      return persist(input.items);
    }
    setSaveError("");
    const current = await loadCouplePlan("trip");
    const result = await saveCouplePlan("trip", input.items, {
      title: input.title || current.title || "우리가 고른 여행",
      subtitle: current.notes,
      startDate: input.startDate,
      dayCount: input.dayCount,
      expectedRevision: current.revision,
    });
    if ("error" in result) {
      setSaveError(result.error);
      return result;
    }
    emitCoupleActivitiesChanged();
    router.push("/trip");
    return { ok: true };
  };

  const finishDate = async () => {
    if ((!items.length && !pendingArchiveRef.current) || recordingRef.current || switchingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    setSaveError("");
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    try {
      await saveQueue.idle();
      if (!pendingArchiveRef.current) {
        const saved = await persist(itemsRef.current);
        if ("error" in saved) return;
        const snapshot = { title: titleRef.current, date: dateRef.current, notes: notesRef.current, items: itemsRef.current };
        const result = await archiveDatePlan(snapshot);
        if ("error" in result) { setSaveError(result.error); return; }
        const remaining = draftsRef.current.filter(day => day.date !== snapshot.date);
        const archive = { ...snapshot, id: result.id };
        pendingArchiveRef.current = { archive, remaining, next: remaining[0] ?? emptyDateDay("") };
        setArchivedDates(current => [archive, ...current.filter(day => day.id !== archive.id)]);
        setArchivePending(true);
        emitCoupleActivitiesChanged();
      }
      const { archive, remaining, next } = pendingArchiveRef.current;
      const cleared = await saveDateDraft(emptyDateDay(archive.date));
      if ("error" in cleared) { setSaveError("기록은 보관했지만 일정 정리를 완료하지 못했어요. " + cleared.error); return; }
      const nextSaved = await persist(next.items, { title: next.title, subtitle: next.notes, startDate: next.date || null, preservePreviousDate: false });
      if ("error" in nextSaved) return;
      applyFocus(next, remaining);
      if (!archive.date) updateUndated(emptyDateDay(""));
      pendingArchiveRef.current = null;
      setArchivePending(false);
      setArchiveFocusId(archive.id);
      setArchiveNotice("오늘 데이트를 기록장에 남겼어요.");
      setShowArchive(true);
      try {
        const refreshed = await listArchivedDatePlans();
        setArchivedDates(refreshed.dates);
      } catch { setSyncError("기록은 보관했지만 최신 기록 목록을 불러오지 못했어요."); }
    } catch {
      setSaveError(pendingArchiveRef.current ? "기록은 보관했어요. 연결을 확인하고 일정 정리를 다시 시도해 주세요." : "기록을 완료하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      recordingRef.current = false;
      setRecording(false);
    }
  };

  return (
    <>
      <SyncNotice message={syncError || tripSyncError} onRetry={retrySync} />
      {archivePending && <div className="sync-notice" role="status"><span>{recording ? "기록을 보관하고 다음 일정을 정리하고 있어요." : saveError || "기록은 보관했어요. 일정 정리를 마쳐 주세요."}</span><button type="button" className="text-button" disabled={recording} onClick={() => void finishDate()}>일정 정리 다시 시도</button></div>}
      {panel === "ai" && (
        <ContextPanel>
          <div inert={switchingDate || recording || archivePending || Boolean(startDate && hasStoredUndated)} style={{ display: "contents" }}>
          <AIPlanEditor kind="date" items={items} startDate={startDate} onApply={apply} onReplace={replace}
            onKeep={keepCourse} tasteSeed={tasteSeed} candidateExplorationActive={candidateExplorationActive} />
          </div>
        </ContextPanel>
      )}
      <div inert={switchingDate || recording || archivePending} style={{ display: "contents" }}>
      <div className="page-title-row date-planner-header">
        <div>
          <span className="eyebrow">DATE PLANNER</span>
          {isTripOnly && !showArchive ? <><h1 className={styles.travelTitle}>{formatKoDate(startDate)}</h1><p className={styles.travelSubtitle}>둘이 함께하는 여행의 하루</p></> : <input className="title-input" value={title} disabled={switchingDate || recording || Boolean(startDate && hasStoredUndated)} onChange={event => { dirtyRef.current = true; unsavedTextRef.current = true; editVersion.current += 1; titleRef.current = event.target.value; setTitle(event.target.value); setNotesSaveState("typing"); }} onBlur={() => { if (unsavedTextRef.current && !switchingRef.current && !recordingRef.current) void persist(itemsRef.current, { title: titleRef.current }); }} aria-label="데이트 제목" />}
        </div>
        <div className="page-actions date-planner-actions trip-planner-actions">
          <DatePickerButton
            value={startDate}
            emptyLabel="날짜 미정 보기"
            ariaLabel="조회할 날짜"
            clearLabel="날짜 미정 코스 보기"
            markedHint="표시된 날짜에는 데이트나 여행 일정이 있어요. 날짜를 고르면 해당 날짜의 일정을 보여 드려요."
            disabled={switchingDate || recording}
            markedDates={markedDates}
            markedLabels={markedLabels}
            onChange={value => void switchDate(value)}
          />
          {!startDate && hasOwnDate && <button className="date-action-button" type="button" onClick={openAssignDate}>미정 코스 날짜 정하기</button>}
          <div className={`save-status${switchingDate || notesSaveState === "saving" ? " is-saving" : ""}`} role="status" aria-live="polite"><i /> {saveError || (switchingDate ? "날짜 일정 여는 중..." : notesSaveState === "saving" ? "저장 중..." : notesSaveState === "typing" ? "아직 저장 전이에요" : tripSyncError ? "여행 재조회 필요" : isTripOnly ? "여행 일정 조회 완료" : hasOwnDate ? "저장됨" : "조회 완료 · 일정 없음")}</div>
          {saveError && <button className="text-button" type="button" disabled={switchingDate || recording} onClick={() => void (saveConflict ? reloadLatest() : persist(itemsRef.current))}>{saveConflict ? "최신 일정 불러오기" : "다시 저장"}</button>}
          {(items.length > 0 || archivedDates.length > 0 || upcoming.length > 0) && (
            <button
              className={`date-action-button is-archive ${showArchive ? "is-active" : ""}`}
              type="button"
              aria-pressed={showArchive}
              onClick={() => setShowArchive(value => !value)}
            >
              지난 데이트
              {archivedDates.length > 0 && <b>{archivedDates.length}</b>}
            </button>
          )}
          <div className="date-action-group">
            <button className={`date-action-button is-ai ${panel === "ai" ? "is-active" : ""}`} type="button" onClick={() => {
              if (window.matchMedia("(max-width: 900px)").matches) { setPanel("ai"); openContextPanel(); }
              else setPanel(panel === "ai" ? null : "ai");
            }}>
              <HeaderActionIcon name="sparkles" />
              <span>AI 추천</span>
            </button>
            {items.length > 0 && (
              <Link className="date-action-button" href={placesHref}>
                <HeaderActionIcon name="plus" />
                <span>장소 더 담기</span>
              </Link>
            )}
          </div>
        </div>
      </div>
      {!showArchive && <p className={styles.viewHint}>날짜를 고르면 그날의 데이트와 여행을 볼 수 있어요.</p>}
      {!showArchive && startDate && hasStoredUndated && <div className={styles.undatedNotice} role="status"><p>아직 날짜를 정하지 않은 데이트가 있어요. 이 날짜의 데이트를 저장하기 전에 미정 코스의 날짜를 먼저 정해 주세요.</p><button className="text-button" type="button" onClick={() => void switchDate("")}>날짜 미정 코스 보기 →</button></div>}
      {saveError && <p className="form-hint">{saveError}</p>}
      {saveConflict && <p className="form-hint">최신 일정을 불러오면 현재 화면의 미저장 변경을 지우고 파트너가 저장한 일정을 보여 드려요.</p>}
      {showArchive ? (
        <DateArchiveJournal
          dates={archivedDates}
          focusId={archiveFocusId}
          canRecord={items.length > 0}
          recording={recording}
          notice={archiveNotice}
          onRecord={finishDate}
          onDismissNotice={() => setArchiveNotice("")}
        />
      ) : <>
        <DateTripPlans days={viewedTripDays} selectedDate={startDate} />
        {!items.length ? viewedTripDays.length > 0 ? (
          <div className={styles.separateDate}>
            <div><h2>이날의 데이트도 따로 계획할까요?</h2><p>여행 외에 함께하고 싶은 장소가 있다면 데이트에 담아 보세요.</p></div>
            <div><button className="outline-button" type="button" disabled={Boolean(startDate && hasStoredUndated)} onClick={() => { setPanel("ai"); openContextPanel(); }}>데이트 추천받기</button><Link className="outline-button" href={placesHref}>장소 찾기</Link></div>
          </div>
        ) : (
        <div className="empty-soft">
          <h2 className={styles.emptyTitle} suppressHydrationWarning>{tripSyncError ? "이날의 데이트를 계획해 볼까요?" : startDate ? `${formatKoDate(startDate)} 일정이 없어요` : "데이트 일정이 없어요"}</h2>
          <p>{startDate ? "이날 함께하고 싶은 장소를 담아 보세요. 날짜를 고르면 다른 날의 약속도 볼 수 있어요." : "어디로 갈지만 말해 주면 하루 코스를 만들어 드려요."}</p>
          <div className="dialog-actions">
            <button className="primary-button" type="button" onClick={() => { setPanel("ai"); openContextPanel(); }}>AI에게 데이트 추천받기</button>
            <Link className="outline-button" href={placesHref}>직접 장소 찾기</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="date-layout">
            <article className={`date-feature ${styles.dateFeature}`}>
              <div>
                <span>NEXT DATE</span>
                <h2 suppressHydrationWarning>{items[0]?.placeName ?? "첫 장소부터"}</h2>
                <ExpandableText className={styles.featureMemo} text={items[0]?.memo || "저장한 장소로 이어진 하루."} lines={4} label={`${items[0]?.placeName || "첫 장소"} 설명`} />
                <div className="date-tags">
                  {items.slice(0, 3).map(item => <b key={item.id}>{item.placeName}</b>)}
                </div>
                <Link className="text-link date-feature-link" href={placesHref}>장소 더 담기 →</Link>
              </div>
            </article>
            <section className="date-plan paper-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">SHARED PLAN</span>
                  <h2 suppressHydrationWarning>{startDate ? formatKoDate(startDate) : "날짜를 아직 안 골랐어요"}</h2>
                  <p className="form-hint date-plan-meta">{items.length === 1 ? "오늘의 한 곳" : `${items.length}곳을 이은 하루`}</p>
                </div>
              </div>
              <div className="date-plan-body">
                <PlanTimeline
                  items={items}
                  columns={items.length >= 3 ? 2 : 1}
                  variant="letter"
                  onReorder={persist}
                  onRemove={id => persist(items.filter(item => item.id !== id))}
                />
                <Link className="add-schedule date-add-letter" href={placesHref}>데이트 장소 추가</Link>
              </div>
            </section>
          </div>
          <label className="field date-notes paper-card">
            <span>우리의  메모</span>
            <textarea
              value={notes}
              disabled={switchingDate || recording || Boolean(startDate && hasStoredUndated)}
              onChange={event => {
                setNotes(event.target.value);
                scheduleNotesSave(event.target.value);
              }}
              onBlur={() => { if (unsavedTextRef.current && !switchingRef.current && !recordingRef.current) void saveNotes(notesRef.current); }}
              placeholder="몇 시에 만날지, 비가 오면 어디로 갈지"
              rows={3}
            />
            <span className={`memo-save-state is-${notesSaveState}`} role="status">
              {notesSaveState === "typing" ? "입력 중 · 잠시 후 자동 저장" : notesSaveState === "saving" ? "저장 중…" : notesSaveState === "error" ? "저장되지 않았어요 · 다시 저장해 주세요" : "자동 저장됨"}
            </span>
          </label>
        </>
      )}</>}
      </div>
      {assignOpen && <div className="dialog-backdrop" onClick={event => { if (event.target === event.currentTarget && !switchingRef.current) setAssignOpen(false); }}>
        <form ref={assignDialogRef} tabIndex={-1} className={`place-create-dialog ${styles.assignDialog}`} role="dialog" aria-modal="true" aria-labelledby="date-assign-title" onSubmit={event => { event.preventDefault(); void assignUndatedDate(); }}>
          <div className="dialog-head"><h2 id="date-assign-title">미정 코스의 날짜를 정할까요?</h2><button type="button" className="icon-button" disabled={switchingDate} aria-label="닫기" onClick={() => setAssignOpen(false)}>×</button></div>
          <p>선택한 날짜에 지금 코스와 메모를 담아요. 여행 일정은 그대로 볼 수 있어요.</p>
          <label className="field"><span>이 데이트를 할 날짜</span><input data-dialog-autofocus type="date" value={assignDate} required disabled={switchingDate} onChange={event => { setAssignDate(event.target.value); setAllowDateReplace(false); }} /></label>
          {assignTarget && <div className={styles.targetWarning}><b>{assignTarget.title}</b><p>이 날짜에 {assignTarget.items.length}곳을 담은 데이트가 있어요. 날짜를 지정하면 이 데이트의 코스와 메모를 교체해요.</p><label><input type="checkbox" checked={allowDateReplace} disabled={switchingDate} onChange={event => setAllowDateReplace(event.target.checked)} />확인한 데이트를 미정 코스로 교체할게요.</label></div>}
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          {saveConflict && <button className="text-button" type="button" disabled={switchingDate} onClick={() => void reloadLatest()}>최신 데이트 확인하기</button>}
          <div className="dialog-actions"><button className="outline-button" type="button" disabled={switchingDate} onClick={() => setAssignOpen(false)}>취소</button><button className="primary-button" type="submit" disabled={switchingDate || !isIsoDate(assignDate) || Boolean(assignTarget && !allowDateReplace)}>{switchingDate ? "날짜 지정 중…" : "확인하고 날짜 지정"}</button></div>
        </form>
      </div>}
    </>
  );
}
