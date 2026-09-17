"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { DatePickerButton } from "@/components/shared/DatePickerButton";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { AIPlanEditor } from "@/features/ai/components/AIPlanEditor";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { preloadPlanVersions, VersionHistory } from "@/features/collaboration/components/VersionHistory";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import { getDraftDateItems, getDraftPlanMeta, setDraftDateItems, setDraftPlanMeta, subscribeDraftTrip } from "@/features/planning/draftTrip";
import { getDemoPlaces, subscribeDemoPlaces } from "@/features/places/demoPlaces";
import type { Place } from "@/features/places/types/place";
import { loadCouplePlan, saveCouplePlan } from "@/features/planning/actions";
import type { PlanChange, PlanItem } from "@/features/planning/types/plan";
import { formatKoDate } from "@/lib/dates";
import { archiveDate, getArchivedDates, subscribeDateArchive, type DateMemory } from "@/features/date/dateArchive";

type Panel = "ai" | "history" | null;

export function DatePlanner() {
  const session = useAppSession();
  const [items, setItems] = useState<PlanItem[]>([]);
  const [title, setTitle] = useState("우리가 고른 데이트");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");
  const [loaded, setLoaded] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [version, setVersion] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [demoPlaces, setDemoPlaces] = useState<Place[]>([]);
  const [notesSaveState, setNotesSaveState] = useState<"saved" | "typing" | "saving">("saved");
  const [showArchive, setShowArchive] = useState(false);
  const [archivedDates, setArchivedDates] = useState<DateMemory[]>([]);
  const [archiveNotice, setArchiveNotice] = useState("");
  const revisionRef = useRef(0);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stored = getDraftDateItems();
    const localMeta = getDraftPlanMeta("date");
    setItems(stored);
    setTitle(localMeta.title);
    setNotes(localMeta.notes);
    setStartDate(localMeta.startDate);
    setDemoPlaces(getDemoPlaces());
    setArchivedDates(getArchivedDates());
    setLoaded(true);

    const unsubscribe = subscribeDraftTrip(() => {
      setItems(getDraftDateItems());
    });
    const unsubscribePlaces = subscribeDemoPlaces(() => setDemoPlaces(getDemoPlaces()));
    const unsubscribeArchive = subscribeDateArchive(() => setArchivedDates(getArchivedDates()));

    if (session.mode !== "authenticated") {
      return () => {
        cancelled = true;
        unsubscribe();
        unsubscribePlaces();
        unsubscribeArchive();
        if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
      };
    }

    void preloadPlanVersions("date").catch(() => undefined);

    void loadCouplePlan("date").then(result => {
      if (cancelled) return;
      revisionRef.current = result.revision;
      if (result.persist && result.items.length) {
        setItems(result.items);
        setDraftDateItems(result.items);
      } else if (stored.length) {
        setItems(stored);
        if (result.persist) {
          void saveCouplePlan("date", stored, { expectedRevision: result.revision }).then(savedResult => {
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
    });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribePlaces();
      unsubscribeArchive();
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
  }, [session.mode]);

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null }) => {
    const mapped = next.map(item => ({ ...item, dayIndex: 0 }));
    setItems(mapped);
    setDraftDateItems(mapped);
    setDraftPlanMeta("date", {
      title: extra?.title ?? title,
      notes: extra?.subtitle ?? notes,
      startDate: extra && "startDate" in extra ? extra.startDate ?? "" : startDate,
      dayCount: 1,
    });
    setSaveError("");
    void saveCouplePlan("date", mapped, {
      title: extra?.title ?? title,
      subtitle: extra?.subtitle ?? notes,
      startDate: extra && "startDate" in extra ? extra.startDate ?? null : startDate || null,
      dayCount: 1,
      expectedRevision: revisionRef.current,
    }).then(result => {
      if ("version" in result) {
        setVersion(result.version);
        revisionRef.current = result.revision;
      } else {
        setSaveError(result.error);
      }
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

  const updateItem = (id: string, patch: Pick<PlanItem, "startTime" | "durationMinutes">) => {
    persist(items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const saveNotes = (value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    setNotesSaveState("saving");
    persist(items, { subtitle: value });
    setNotesSaveState("saved");
  };

  const scheduleNotesSave = (value: string) => {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    setNotesSaveState("typing");
    notesTimerRef.current = setTimeout(() => saveNotes(value), 800);
  };

  const replace = (next: PlanItem[]) => {
    persist(next);
    setPanel("history");
  };

  const finishDate = () => {
    if (!items.length) return;
    archiveDate({ title, date: startDate, notes, items });
    setArchiveNotice("현재 데이트를 지난 데이트에 저장했어요.");
    setShowArchive(true);
  };

  const context = panel === "ai"
    ? <AIPlanEditor kind="date" items={items} places={demoPlaces.length ? demoPlaces : undefined} onApply={apply} onReplace={replace} />
    : panel === "history"
      ? <VersionHistory kind="date" latest={version} onRestore={replace} />
      : undefined;

  return (
    <AppShell context={context}>
      <div className="page-title-row date-planner-header">
        <div>
          <span className="eyebrow">DATE PLANNER</span>
          {loaded && items.length ? (
            <input className="title-input" value={title} onChange={event => setTitle(event.target.value)} onBlur={() => persist(items, { title })} aria-label="데이트 제목" />
          ) : (
            <h1>{!loaded ? "일정을 불러오는 중이에요" : "다음 데이트를 아직 안 잡았어요"}</h1>
          )}
          {!items.length && (
            <p>{!loaded ? "저장된 오후 일정을 가져오고 있어요." : "원하는 조건을 말하면 AI가 실제 장소를 찾아 코스로 이어 드려요."}</p>
          )}
        </div>
        <div className="page-actions date-planner-actions date-toolbar">
          <DatePickerButton
            value={startDate}
            emptyLabel="날짜 고르기"
            ariaLabel="데이트 날짜"
            onChange={value => {
              setStartDate(value);
              persist(items, { startDate: value || null });
            }}
          />
          <div className="save-status"><i /> {saveError || "저장됨"}</div>
          <div className="date-action-group">
              {(items.length > 0 || archivedDates.length > 0) && (
              <button className={`date-action-button is-archive ${showArchive ? "is-active" : ""}`} type="button" onClick={() => setShowArchive(value => !value)}>
                <HeaderActionIcon name="archive" />
                <span>지난 데이트</span>
                <b>{archivedDates.length}</b>
              </button>
              )}
              {items.length > 0 && (
                <button className={`date-action-button is-history ${panel === "history" ? "is-active" : ""}`} type="button" onClick={() => setPanel(panel === "history" ? null : "history")}>
                  <HeaderActionIcon name="history" />
                  <span>변경 기록</span>
                </button>
              )}
              <button className={`date-action-button is-ai ${panel === "ai" ? "is-active" : ""}`} type="button" onClick={() => setPanel(panel === "ai" ? null : "ai")}>
                <HeaderActionIcon name="sparkles" />
                <span>AI 추천</span>
              </button>
              {items.length > 0 && (
                <Link className="date-action-button is-primary" href="/places?from=date">
                  <HeaderActionIcon name="plus" />
                  <span>장소 더 담기</span>
                </Link>
              )}
          </div>
        </div>
      </div>
      {saveError && <p className="form-hint">{saveError}</p>}
      {showArchive ? (
        <section className="date-archive paper-card">
          <div className="date-archive-head">
            <div><span className="eyebrow">PAST DATES</span><h2>함께 보낸 데이트</h2><p>사라지지 않고 둘의 기록으로 차곡차곡 남아요.</p></div>
            {items.length > 0 && <button className="date-action-button is-primary" type="button" onClick={finishDate}><HeaderActionIcon name="archive" /><span>현재 데이트 기록하기</span></button>}
          </div>
          {archiveNotice && <p className="date-archive-notice">{archiveNotice}</p>}
          <div className="date-archive-grid">
            {archivedDates.map((date, index) => (
              <article key={date.id}>
                <div className={`date-archive-art variant-${index % 3}`}><span>{date.date ? formatKoDate(date.date) : "날짜 미정"}</span><b>{date.items.length}</b><small>PLACES</small></div>
                <div><span>{date.date || "날짜 미정"}</span><h3>{date.title}</h3><p>{date.notes || date.items.map(item => item.placeName).join(" · ")}</p><div>{date.items.slice(0, 3).map(item => <b key={item.id}>{item.placeName}</b>)}</div></div>
              </article>
            ))}
          </div>
        </section>
      ) : !loaded ? (
        <p className="form-hint">일정을 불러오는 중이에요.</p>
      ) : !items.length ? (
        <div className="empty-soft">
          <h1>데이트 초안이 비어 있어요</h1>
          <p>{demoPlaces.length ? `저장한 장소 ${demoPlaces.length}곳과 새로운 후보를 함께 비교해 드릴게요.` : "지역·시간·예산을 말하면 실제 장소를 찾아 하루 코스로 이어 드려요."}</p>
          <div className="dialog-actions">
            <button className="primary-button" type="button" onClick={() => setPanel("ai")}>AI에게 데이트 추천받기</button>
            <Link className="outline-button" href="/places?from=date">직접 장소 찾기</Link>
          </div>
        </div>
      ) : (
        <div className="date-layout">
          <article className="date-feature">
            <div>
              <span>NEXT DATE</span>
              <h2>{items[0]?.placeName ?? "첫 장소부터"}</h2>
              <p>{items[0]?.memo || "저장한 장소로 이어진 하루."}</p>
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
                <h2>{startDate ? formatKoDate(startDate) : "날짜를 아직 안 골랐어요"}</h2>
              </div>
            </div>
            <PlanTimeline items={items} onReorder={persist} onUpdate={updateItem} onRemove={id => persist(items.filter(item => item.id !== id))} />
            <Link className="add-schedule" href="/places?from=date">＋ 장소 추가</Link>
            <label className="field date-notes">
              <span>둘만의 메모</span>
              <textarea
                value={notes}
                onChange={event => {
                  setNotes(event.target.value);
                  scheduleNotesSave(event.target.value);
                }}
                onBlur={() => notesSaveState !== "saved" && saveNotes(notes)}
                placeholder="몇 시에 만날지, 비가 오면 어디로 갈지"
                rows={4}
              />
              <span className={`memo-save-state is-${notesSaveState}`} role="status">
                {notesSaveState === "typing" ? "입력 중 · 잠시 후 자동 저장" : notesSaveState === "saving" ? "저장 중…" : "✓ 자동 저장됨"}
              </span>
            </label>
          </section>
        </div>
      )}
    </AppShell>
  );
}
