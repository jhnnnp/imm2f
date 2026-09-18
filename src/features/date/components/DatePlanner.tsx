"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { DateArchiveJournal } from "@/features/date/components/DateArchiveJournal";
import { applyDateSwitch, emptyDateDay, hasDateContent, landingDateDay, upsertDateDay, type DateDaySnapshot } from "@/features/date/dateDays";
import type { CourseKeepInput, CourseKeepResult } from "@/features/ai/courseKeep";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import { useHydratePlanCoordinates } from "@/features/planning/useHydratePlanCoordinates";
import { archiveDatePlan, listArchivedDatePlans, loadCouplePlan, openDateDay, saveCouplePlan, saveDateDraft, type ArchivedDatePlan } from "@/features/planning/actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import type { CouplePlan, PlanChange, PlanItem } from "@/features/planning/types/plan";
import type { TasteDateSeed } from "@/features/taste/types";
import { formatKoDate } from "@/lib/dates";

const AIPlanEditor = dynamic(
  () => import("@/features/ai/components/AIPlanEditor").then(mod => mod.AIPlanEditor),
  { ssr: false, loading: () => <div className="panel-loading" aria-label="AI 플래너 불러오는 중"><i /><i /><i /></div> },
);

type Panel = "ai" | null;

export function DatePlanner({
  initialPlan,
  initialArchives,
  initialDrafts = [],
  today,
  tasteSeed = null,
}: {
  initialPlan: CouplePlan;
  initialArchives: ArchivedDatePlan[];
  initialDrafts?: DateDaySnapshot[];
  today: string;
  tasteSeed?: TasteDateSeed | null;
}) {
  const landed = landingDateDay({ plan: initialPlan, drafts: initialDrafts, today });
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[]>(landed.focus.items);
  const [title, setTitle] = useState(landed.focus.title || "우리가 고른 데이트");
  const [notes, setNotes] = useState(landed.focus.notes);
  const [startDate, setStartDate] = useState(landed.focus.date);
  const [drafts, setDrafts] = useState<DateDaySnapshot[]>(landed.drafts);
  const [panel, setPanel] = useState<Panel>(tasteSeed ? "ai" : null);
  const [saveError, setSaveError] = useState("");
  const [notesSaveState, setNotesSaveState] = useState<"saved" | "typing" | "saving">("saved");
  const [showArchive, setShowArchive] = useState(false);
  const [archivedDates, setArchivedDates] = useState<ArchivedDatePlan[]>(initialArchives);
  const [archiveNotice, setArchiveNotice] = useState("");
  const [archiveFocusId, setArchiveFocusId] = useState("");
  const [recording, setRecording] = useState(false);
  const revisionRef = useRef(initialPlan.revision);
  const saveQueueRef = useRef(Promise.resolve());
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  const notesRef = useRef(notes);
  const dateRef = useRef(startDate);
  titleRef.current = title;
  notesRef.current = notes;
  dateRef.current = startDate;

  useHydratePlanCoordinates("date", items, setItems);

  useEffect(() => {
    if (initialPlan.startDate === today) return;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const result = await openDateDay({
        fromDate: initialPlan.startDate,
        toDate: today,
        snapshot: {
          title: initialPlan.title || "우리가 고른 데이트",
          notes: initialPlan.notes,
          items: initialPlan.items,
        },
        expectedRevision: revisionRef.current,
      });
      if ("revision" in result) revisionRef.current = result.revision;
    });
  }, [initialPlan, today]);

  useEffect(() => {
    return () => {
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
  }, []);

  const upcoming = useMemo(
    () => drafts.filter(day => hasDateContent(day)),
    [drafts],
  );
  const markedDates = upcoming.map(day => day.date);
  const markedLabels = useMemo(
    () => Object.fromEntries(upcoming.map(day => [
      day.date,
      `${day.items[0]?.placeName || "데이트"}${day.items.length > 1 ? ` 외 ${day.items.length - 1}곳` : ""}`,
    ])),
    [upcoming],
  );

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null }) => {
    const mapped = next.map(item => ({ ...item, dayIndex: item.dayIndex ?? 0 }));
    const nextTitle = extra?.title ?? titleRef.current;
    const nextNotes = extra && "subtitle" in extra ? extra.subtitle ?? "" : notesRef.current;
    const nextDate = extra && "startDate" in extra ? extra.startDate ?? "" : dateRef.current;
    setItems(mapped);
    setSaveError("");
    setNotesSaveState("saving");
    if (nextDate) {
      setDrafts(current => upsertDateDay(current, { date: nextDate, title: nextTitle, notes: nextNotes, items: mapped }));
    }
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const result = await saveCouplePlan("date", mapped, {
        title: nextTitle,
        subtitle: nextNotes,
        startDate: nextDate || null,
        dayCount: Math.max(1, ...mapped.map(item => (item.dayIndex ?? 0) + 1)),
        expectedRevision: revisionRef.current,
      });
      if ("version" in result) {
        revisionRef.current = result.revision;
        emitCoupleActivitiesChanged();
        if (nextDate) {
          await saveDateDraft({ date: nextDate, title: nextTitle, notes: nextNotes, items: mapped });
        }
      } else {
        setSaveError(result.error);
      }
      setNotesSaveState("saved");
    });
  };

  const applyFocus = (focus: DateDaySnapshot, nextDrafts: DateDaySnapshot[]) => {
    setDrafts(nextDrafts);
    setStartDate(focus.date);
    setTitle(focus.title);
    setNotes(focus.notes);
    setItems(focus.items);
    setShowArchive(false);
  };

  const switchDate = (nextDate: string) => {
    if (nextDate === startDate) return;
    const snapshot = { title, notes, items };
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      setSaveError("");
      setNotesSaveState("saving");
      const result = await openDateDay({
        fromDate: startDate || null,
        toDate: nextDate || null,
        snapshot,
        expectedRevision: revisionRef.current,
      });
      if ("error" in result) {
        const local = applyDateSwitch({
          current: { date: startDate, ...snapshot },
          drafts,
          nextDate,
        });
        applyFocus(local.focus, local.drafts);
        const saved = await saveCouplePlan("date", local.focus.items, {
          title: local.focus.title,
          subtitle: local.focus.notes,
          startDate: local.focus.date || null,
          dayCount: 1,
          expectedRevision: revisionRef.current,
        });
        if ("version" in saved) {
          revisionRef.current = saved.revision;
          emitCoupleActivitiesChanged();
        }
        else setSaveError(saved.error);
        setNotesSaveState("saved");
        return;
      }
      revisionRef.current = result.revision;
      applyFocus(result.focus, result.drafts);
      setNotesSaveState("saved");
    });
  };

  const apply = (changes: PlanChange[]) => {
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
  };

  const saveNotes = (value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    persist(items, { subtitle: value });
  };

  const scheduleNotesSave = (value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    setNotesSaveState("typing");
    notesTimerRef.current = setTimeout(() => saveNotes(value), 800);
  };

  const replace = (next: PlanItem[]) => {
    persist(next);
  };

  const keepCourse = async (input: CourseKeepInput): Promise<CourseKeepResult> => {
    if (input.destination === "date") {
      persist(input.items);
      return { ok: true };
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
    if (!items.length || recording) return;
    setRecording(true);
    setSaveError("");
    const result = await archiveDatePlan({ title, date: startDate, notes, items });
    if ("error" in result) {
      setSaveError(result.error);
      setRecording(false);
      return;
    }
    emitCoupleActivitiesChanged();
    const remaining = drafts.filter(day => day.date !== startDate);
    const next = remaining[0] ?? emptyDateDay("");
    await saveDateDraft(emptyDateDay(startDate));
    persist(next.items, { title: next.title, subtitle: next.notes, startDate: next.date || null });
    applyFocus(next, remaining);
    const refreshed = await listArchivedDatePlans();
    setArchivedDates(refreshed.dates);
    setArchiveFocusId(result.id);
    setArchiveNotice("오늘 데이트를 기록장에 남겼어요.");
    setShowArchive(true);
    setRecording(false);
  };

  return (
    <>
      {panel === "ai" && (
        <ContextPanel>
          <AIPlanEditor kind="date" items={items} startDate={startDate} onApply={apply} onReplace={replace} onKeep={keepCourse} tasteSeed={tasteSeed} />
        </ContextPanel>
      )}
      <div className="page-title-row date-planner-header">
        <div>
          <span className="eyebrow">DATE PLANNER</span>
          <input className="title-input" value={title} onChange={event => setTitle(event.target.value)} onBlur={() => persist(items, { title })} aria-label="데이트 제목" />
        </div>
        <div className="page-actions date-planner-actions trip-planner-actions">
          <DatePickerButton
            value={startDate}
            emptyLabel="날짜 고르기"
            ariaLabel="데이트 날짜"
            markedDates={markedDates}
            markedLabels={markedLabels}
            onChange={switchDate}
          />
          <div className="save-status"><i /> {saveError || (notesSaveState === "saving" ? "저장 중..." : "저장됨")}</div>
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
            <button className={`date-action-button is-ai ${panel === "ai" ? "is-active" : ""}`} type="button" onClick={() => setPanel(panel === "ai" ? null : "ai")}>
              <HeaderActionIcon name="sparkles" />
              <span>AI 추천</span>
            </button>
            {items.length > 0 && (
              <Link className="date-action-button" href="/places?from=date">
                <HeaderActionIcon name="plus" />
                <span>장소 더 담기</span>
              </Link>
            )}
          </div>
        </div>
      </div>
      {saveError && <p className="form-hint">{saveError}</p>}
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
      ) : !items.length ? (
        <div className="empty-soft">
          <h1 suppressHydrationWarning>{startDate ? `${formatKoDate(startDate)} 일정이 없어요` : "데이트 일정이 없어요"}</h1>
          <p>{startDate ? "이 날만 따로 짜면 돼요. 다른 날짜 코스는 그대로 남아 있어요." : "어디로 갈지만 말해 주면 하루 코스를 만들어 드려요."}</p>
          <div className="dialog-actions">
            <button className="primary-button" type="button" onClick={() => setPanel("ai")}>AI에게 데이트 추천받기</button>
            <Link className="outline-button" href="/places?from=date">직접 장소 찾기</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="date-layout">
            <article className="date-feature">
              <div>
                <span>NEXT DATE</span>
                <h2 suppressHydrationWarning>{items[0]?.placeName ?? "첫 장소부터"}</h2>
                <p suppressHydrationWarning>{items[0]?.memo || "저장한 장소로 이어진 하루."}</p>
                <div className="date-tags">
                  {items.slice(0, 3).map(item => <b key={item.id}>{item.placeName}</b>)}
                </div>
                <Link className="text-link date-feature-link" href="/places?from=date">장소 더 담기 →</Link>
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
                <Link className="add-schedule date-add-letter" href="/places?from=date">한 장 더 끼워 넣기</Link>
              </div>
            </section>
          </div>
          <label className="field date-notes paper-card">
            <span>우리의  메모</span>
            <textarea
              value={notes}
              onChange={event => {
                setNotes(event.target.value);
                scheduleNotesSave(event.target.value);
              }}
              onBlur={() => notesSaveState !== "saved" && saveNotes(notes)}
              placeholder="몇 시에 만날지, 비가 오면 어디로 갈지"
              rows={3}
            />
            <span className={`memo-save-state is-${notesSaveState}`} role="status">
              {notesSaveState === "typing" ? "입력 중 · 잠시 후 자동 저장" : notesSaveState === "saving" ? "저장 중…" : "자동 저장됨"}
            </span>
          </label>
        </>
      )}
    </>
  );
}
