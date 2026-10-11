"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readCalendarWorkspace } from "@/features/collaboration/workspaceReads";
import { hasDateContent, upsertDateDay, type DateDaySnapshot } from "@/features/date/dateDays";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import type { CouplePlan } from "@/features/planning/types/plan";
import { formatKoDate, toIsoDate, seoulTodayIso } from "@/lib/dates";
import { SyncNotice } from "@/components/shared/SyncNotice";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { TripDateSnapshot } from "@/features/trip/tripDates";
import { tripDateRange } from "@/features/trip/tripDates";
import { calendarTrips, tripsOnDate } from "../tripCalendar";
import { useDialogFocus } from "@/components/shared/useDialogFocus";

type MemoryMark = { id: string; title: string; happenedOn: string };

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function CalendarBoard({
  trip,
  date,
  memories: initialMemories,
  drafts: initialDrafts,
  tripDrafts: initialTripDrafts = [],
  archives: initialArchives = [],
}: {
  trip: CouplePlan;
  date: CouplePlan;
  memories: MemoryMark[];
  drafts: DateDaySnapshot[];
  tripDrafts?: TripDateSnapshot[];
  archives?: ArchivedTripPlan[];
}) {
  const [cursor, setCursor] = useState<Date | null>(null);
  const [todayIso, setTodayIso] = useState("");
  const [selected, setSelected] = useState("");
  const [dateStart, setDateStart] = useState(date.startDate ?? "");
  const [memories, setMemories] = useState(initialMemories);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [tripPlan, setTripPlan] = useState(trip);
  const [datePlan, setDatePlan] = useState(date);
  const [tripDrafts, setTripDrafts] = useState(initialTripDrafts);
  const [tripArchives, setTripArchives] = useState(initialArchives);
  const [modalOpen, setModalOpen] = useState(false);
  const [syncError, setSyncError] = useState("");
  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    try {
      const { trip: nextTrip, date: nextDate, drafts: nextDrafts, memories: nextMemories, tripDrafts: nextTripDrafts, archives } = await readCalendarWorkspace();
      if (!isCurrent()) return;
      setTripPlan(nextTrip); setTripDrafts(nextTripDrafts); setTripArchives(archives);
      setDatePlan(nextDate); setDateStart(nextDate.startDate ?? "");
      setDrafts(nextDrafts); setMemories(nextMemories);
      setSyncError("");
    } catch {
      if (isCurrent()) setSyncError("최신 약속을 불러오지 못했어요. 표시 중인 캘린더는 그대로 있어요.");
    }
  }, { tables: ["activities", "trip_drafts"], activityPrefixes: ["DATE_", "TRIP_", "MEMORY_", "PARTNER_"] });
  const dateDays = useMemo(() => {
    const current = { date: dateStart, title: datePlan.title, notes: datePlan.notes, items: datePlan.items };
    return (dateStart && hasDateContent(current) ? upsertDateDay(drafts, current) : drafts).filter(hasDateContent);
  }, [dateStart, datePlan, drafts]);

  const modalRef = useDialogFocus<HTMLElement>({ open: modalOpen, onClose: () => setModalOpen(false) });

  useEffect(() => {
    const iso = seoulTodayIso();
    const now = new Date(`${iso}T12:00:00`);
    setCursor(now);
    setTodayIso(iso);
    setSelected(iso);
  }, []);

  const trips = useMemo(() => calendarTrips(tripPlan, tripDrafts, tripArchives), [tripPlan, tripDrafts, tripArchives]);
  const selectedTrips = useMemo(() => tripsOnDate(trips, selected), [trips, selected]);

  const selectedEvents = useMemo(() => {
    if (!selected) return [] as Array<{ id: string; kind: string; title: string; href: string; detail: string }>;
    const events = [];
    for (const { trip, day, href, items } of selectedTrips) {
      events.push({
        id: trip.id, kind: trip.archived ? "여행기록" : "여행",
        title: trip.title || "우리가 고른 여행", href,
        detail: `${tripDateRange(trip.startDate, trip.dayCount)} · DAY ${day + 1} · ${items.length}곳`,
      });
    }
    const selectedDate = dateDays.find(day => day.date === selected);
    if (selectedDate) {
      events.push({
        id: `date:${selected}`, kind: "데이트",
        title: selectedDate.title || "우리가 고른 데이트",
        href: `/date?day=${selected}`,
        detail: `${selectedDate.items.length}곳${selectedDate.notes ? " · 메모 있음" : ""}`,
      });
    }
    const archiveIds = new Set(tripArchives.map(archive => archive.id));
    memories.filter(item => item.happenedOn === selected && !archiveIds.has(item.id)).forEach(item => {
      events.push({ id: `memory:${item.id}`, kind: "추억", title: item.title, href: "/memories", detail: "그날의 기록" });
    });
    return events;
  }, [selected, selectedTrips, tripArchives, dateDays, memories]);
  const selectedStops = useMemo(() => {
    return [
      ...selectedTrips.flatMap(({ trip, items }) => items.map(item => ({ ...item, source: trip.title || "여행", sourceId: trip.id }))),
      ...[...(dateDays.find(day => day.date === selected)?.items ?? [])].sort((a, b) => a.order - b.order).map(item => ({ ...item, source: "데이트", sourceId: "date" })),
    ];
  }, [selectedTrips, dateDays, selected]);

  if (!cursor) {
    return <p className="form-hint">캘린더를 펼치고 있어요.</p>;
  }

  const view = cursor;
  const first = startOfMonth(view);
  const pad = (first.getDay() + 6) % 7;
  const total = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((pad + total) / 7) * 7;
  const gridStart = new Date(view.getFullYear(), view.getMonth(), 1 - pad);
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return {
      date: cellDate,
      day: cellDate.getDate(),
      iso: toIsoDate(cellDate),
      outside: cellDate.getMonth() !== view.getMonth(),
    };
  });
  const monthLabel = view.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

  function goToday() {
    const iso = seoulTodayIso();
    const now = new Date(`${iso}T12:00:00`);
    setCursor(now);
    setSelected(iso);
  }

  return (
    <>
    <SyncNotice message={syncError} onRetry={retrySync} />
    <div className="calendar-layout">
      <div className="calendar-grid">
        <div className="calendar-month-nav">
          <div className="calendar-month-controls">
            <button type="button" className="calendar-nav-button" onClick={() => setCursor(current => (current ? shiftMonth(current, -1) : current))} aria-label="이전 달">‹</button>
            <strong>{monthLabel}</strong>
            <button type="button" className="calendar-nav-button" onClick={() => setCursor(current => (current ? shiftMonth(current, 1) : current))} aria-label="다음 달">›</button>
          </div>
          <button type="button" className="calendar-today-button" onClick={goToday}>오늘</button>
        </div>
        <div className="week labels">{["월", "화", "수", "목", "금", "토", "일"].map(day => <span key={day}>{day}</span>)}</div>
        <div className="week dates calendar-dates">
          {cells.map(cell => {
            const iso = cell.iso;
            const isToday = iso === todayIso;
            const isSelected = iso === selected;
            const marks = [
              tripsOnDate(trips, iso).length ? { label: "여행", className: "is-trip" } : null,
              dateDays.some(day => day.date === iso) ? { label: "데이트", className: "is-date" } : null,
              memories.some(item => item.happenedOn === iso) ? { label: "추억", className: "is-memory" } : null,
            ].filter(Boolean);
            return (
              <button
                type="button"
                className={`${isToday ? "today-cell" : ""} ${isSelected ? "is-selected" : ""} ${cell.outside ? "is-outside" : ""}`}
                key={iso}
                aria-label={`${formatKoDate(iso)}${marks.length ? ` · ${marks.map(mark => mark?.label).join(", ")}` : " · 일정 없음"}`}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                onClick={() => {
                  setSelected(iso);
                  setModalOpen(true);
                  if (cell.outside) setCursor(startOfMonth(cell.date));
                }}
              >
                <b>{cell.day}</b>
                <span className="calendar-cell-events">
                  {marks.slice(0, 2).map(mark => mark && <small className={mark.className} key={mark.label}>{mark.label}</small>)}
                  {marks.length > 2 && <small className="is-more">+{marks.length - 2}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {modalOpen && (
        <div className="calendar-modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setModalOpen(false);
        }}>
          <section ref={modalRef} tabIndex={-1} className="calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title">
            <button data-dialog-autofocus className="calendar-modal-close" type="button" aria-label="닫기" onClick={() => setModalOpen(false)}>×</button>
            <span className="eyebrow">DAY DETAILS</span>
            <h2 id="calendar-modal-title">{selected ? formatKoDate(selected) : "선택한 날짜"}</h2>

            {selectedEvents.length > 0 ? (
              <div className="calendar-event-list">
                {selectedEvents.map(event => (
                  <Link className="calendar-event" href={event.href} key={event.id}>
                    <span>{event.kind}</span>
                    <b>{event.title}</b>
                    <small>{event.detail}</small>
                    <em>일정 보기 →</em>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="calendar-modal-empty">
                <b>아직 일정이 없는 날이에요.</b>
                <p>함께 보낼 하루를 계획해 볼까요?</p>
              </div>
            )}
            {selectedStops.length > 0 && <ol className="calendar-day-agenda" aria-label="이날의 장소 순서">{selectedStops.map((item, index) => <li key={`${item.sourceId}-${item.id}`}><time>{index + 1}</time><span><b>{item.placeName}</b><small>{item.source}{item.memo ? ` · ${item.memo}` : ""}</small></span></li>)}</ol>}
            <div className="calendar-assign"><Link className="primary-button" href={`/date?day=${selected}`}>이날의 데이트 계획하기</Link></div>
          </section>
        </div>
      )}
    </div>
    </>
  );
}
