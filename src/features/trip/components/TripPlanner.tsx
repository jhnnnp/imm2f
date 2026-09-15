"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { AIPlanEditor } from "@/features/ai/components/AIPlanEditor";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";
import { BudgetPanel } from "@/features/collaboration/components/BudgetPanel";
import { VersionHistory } from "@/features/collaboration/components/VersionHistory";
import { loadPlanVersions } from "@/features/collaboration/actions";
import { getActiveTripDay, getDraftTripItems, setActiveTripDay, setDraftTripItems, subscribeDraftTrip } from "@/features/planning/draftTrip";
import { loadCouplePlan, saveCouplePlan } from "@/features/planning/actions";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import type { PlanChange, PlanItem } from "@/features/planning/types/plan";
import { addDays, formatKoDate, formatKoShort, formatWon } from "@/lib/dates";
import { PlanMap } from "./PlanMap";

type Panel = "ai" | "history" | "activity";
type Tab = "schedule" | "map" | "budget" | "notes";

function mergeDay(all: PlanItem[], dayIndex: number, nextDay: PlanItem[]) {
  const others = all.filter(item => (item.dayIndex ?? 0) !== dayIndex);
  return [...others, ...nextDay.map((item, order) => ({ ...item, dayIndex, order }))]
    .sort((a, b) => (a.dayIndex - b.dayIndex) || a.startTime.localeCompare(b.startTime) || a.order - b.order)
    .map((item, order) => ({ ...item, order }));
}

export function TripPlanner() {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [title, setTitle] = useState("우리가 고른 여행");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dayCount, setDayCount] = useState(1);
  const [selectedDay, setSelectedDay] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [panel, setPanel] = useState<Panel>("history");
  const [tab, setTab] = useState<Tab>("schedule");
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const revisionRef = useRef(0);
  const total = useMemo(() => items.reduce((sum, item) => sum + item.expectedCost, 0), [items]);
  const dayItems = useMemo(
    () => items.filter(item => (item.dayIndex ?? 0) === selectedDay),
    [items, selectedDay],
  );
  const dayCost = useMemo(() => dayItems.reduce((sum, item) => sum + item.expectedCost, 0), [dayItems]);
  const dayLabel = `DAY ${selectedDay + 1}`;
  const dayDate = startDate ? formatKoDate(addDays(startDate, selectedDay)) : "";

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadCouplePlan("trip"), loadPlanVersions("trip")]).then(([result, versions]) => {
      if (cancelled) return;
      setVersion(versions.latest);
      revisionRef.current = result.revision;
      const stored = getDraftTripItems();
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
      if (result.title) setTitle(result.title);
      if (result.notes) setNotes(result.notes);
      if (result.startDate) setStartDate(result.startDate);
      setDayCount(Math.max(1, result.dayCount || 1));
      const active = Math.min(getActiveTripDay(), Math.max(0, (result.dayCount || 1) - 1));
      setSelectedDay(active);
      setActiveTripDay(active);
      setLoaded(true);
    });
    const unsubscribe = subscribeDraftTrip(() => {
      const next = getDraftTripItems();
      if (next.length) setItems(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number }) => {
    setSaved(false);
    setSaveError("");
    setItems(next);
    setDraftTripItems(next);
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
    ? <AIPlanEditor kind="trip" items={dayItems.length ? dayItems : items} onApply={apply} onReplace={replace} />
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
          <p>
            {!loaded
              ? "저장된 하루를 가져오고 있어요."
              : items.length
                ? `${dayCount}일 · ${items.length}곳 · 예상 ₩${formatWon(total)}${startDate ? ` · ${formatKoDate(startDate)}부터` : ""}`
                : "장소를 담고, 필요하면 AI가 하루 순서를 잡아 줘요."}
          </p>
        </div>
        <div className="page-actions">
          <label className="date-field">
            <span>시작일</span>
            <input
              type="date"
              value={startDate}
              onChange={event => {
                setStartDate(event.target.value);
                persist(items, { startDate: event.target.value || null });
              }}
            />
          </label>
          <div className="save-status"><i /> {saveError || (saved ? "저장됨" : "저장 중...")}</div>
          <button className="outline-button" type="button" onClick={() => setPanel("activity")}>최근 활동</button>
          <button className="more-button" type="button" onClick={() => setPanel("ai")}>AI</button>
        </div>
      </div>
      <div className="trip-tabs">
        <button className={tab === "schedule" ? "is-active" : ""} type="button" onClick={() => setTab("schedule")}>일정</button>
        <button className={tab === "map" ? "is-active" : ""} type="button" onClick={() => setTab("map")}>지도</button>
        <button className={tab === "budget" ? "is-active" : ""} type="button" onClick={() => setTab("budget")}>예산 <b>₩{formatWon(total)}</b></button>
        <button className={tab === "notes" ? "is-active" : ""} type="button" onClick={() => setTab("notes")}>여행 노트</button>
        <button type="button" onClick={() => setPanel("history")}>버전 <b>{version || "-"}</b></button>
      </div>

      {tab === "budget" ? (
        <BudgetPanel items={items} />
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
                <Link className="primary-button" href="/places">장소 담기</Link>
              </div>
            )
          ) : (
            <section className="plan-column">
              <div className="plan-day-head">
                <div>
                  <span className="eyebrow">{dayLabel}</span>
                  <h2>{dayItems.length ? "이 날에 담은 장소" : "이 날은 아직 비어 있어요"}</h2>
                  {startDate && <p className="form-hint">{dayDate} · 예상 ₩{formatWon(dayCost)}</p>}
                </div>
              </div>
              {loaded && !dayItems.length ? (
                <div className="empty-soft planner-empty">
                  <h1>{items.length ? "이날은 비어 있어요" : "여행 초안이 비어 있어요"}</h1>
                  <p>Places에서 담고, 오른쪽 AI로 3안을 만들 수 있어요. 담기는 지금 고른 날에 붙어요.</p>
                  <div className="dialog-actions">
                    <Link className="primary-button" href="/places">장소에서 추가</Link>
                    <button className="outline-button" type="button" onClick={() => setPanel("ai")}>AI로 3안 만들기</button>
                  </div>
                </div>
              ) : (
                <>
                  <PlanTimeline
                    items={dayItems}
                    onReorder={next => persist(mergeDay(items, selectedDay, next))}
                    onRemove={id => persist(items.filter(item => item.id !== id))}
                  />
                  <Link className="add-schedule" href="/places">＋ 이 날에 장소 추가</Link>
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
