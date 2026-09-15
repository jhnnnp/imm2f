"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { saveCouplePlan } from "@/features/planning/actions";
import type { CouplePlan } from "@/features/planning/types/plan";
import { addDays, formatKoDate, formatKoShort, toIsoDate } from "@/lib/dates";

type MemoryMark = { id: string; title: string; happenedOn: string };

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function shiftMonth(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function CalendarBoard({
  trip,
  date,
  memories,
}: {
  trip: CouplePlan;
  date: CouplePlan;
  memories: MemoryMark[];
}) {
  const [cursor, setCursor] = useState<Date | null>(null);
  const [todayIso, setTodayIso] = useState("");
  const [selected, setSelected] = useState("");
  const [tripStart, setTripStart] = useState(trip.startDate ?? "");
  const [dateStart, setDateStart] = useState(date.startDate ?? "");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const now = new Date();
    setCursor(now);
    const iso = toIsoDate(now);
    setTodayIso(iso);
    setSelected(iso);
  }, []);

  const tripDays = useMemo(() => {
    if (!tripStart) return new Set<string>();
    return new Set(Array.from({ length: Math.max(1, trip.dayCount || 1) }, (_, index) => addDays(tripStart, index)));
  }, [tripStart, trip.dayCount]);

  const selectedEvents = useMemo(() => {
    if (!selected) return [] as Array<{ kind: string; title: string; href: string; detail: string }>;
    const events = [];
    if (tripDays.has(selected) && trip.items.length) {
      const offset = [...tripDays].sort().indexOf(selected);
      events.push({
        kind: "여행",
        title: trip.title || "우리가 고른 여행",
        href: "/trip",
        detail: `DAY ${offset + 1} · ${trip.items.filter(item => (item.dayIndex ?? 0) === offset).length || trip.items.length}곳`,
      });
    }
    if (dateStart === selected && date.items.length) {
      events.push({
        kind: "데이트",
        title: date.title || "우리가 고른 데이트",
        href: "/date",
        detail: `${date.items.length}곳`,
      });
    }
    memories.filter(item => item.happenedOn === selected).forEach(item => {
      events.push({ kind: "추억", title: item.title, href: "/memories", detail: "그날의 기록" });
    });
    return events;
  }, [selected, tripDays, trip, dateStart, date, memories]);

  async function assign(kind: "trip" | "date") {
    const startDate = selected || todayIso;
    if (!startDate) return;
    const plan = kind === "trip" ? trip : date;
    const result = await saveCouplePlan(kind, plan.items, {
      title: plan.title,
      subtitle: plan.notes,
      startDate,
      dayCount: kind === "trip" ? plan.dayCount : 1,
      expectedRevision: plan.revision,
    });
    if ("error" in result) {
      setNotice(result.error);
      return;
    }
    if (kind === "trip") setTripStart(startDate);
    else setDateStart(startDate);
    setNotice(kind === "trip" ? "여행 시작일을 붙였어요." : "데이트 날짜를 붙였어요.");
  }

  if (!cursor) {
    return <p className="form-hint">캘린더를 펼치고 있어요.</p>;
  }

  const view = cursor;
  const first = startOfMonth(view);
  const total = daysInMonth(view);
  const pad = (first.getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const monthLabel = view.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

  function isoFor(day: number) {
    return toIsoDate(new Date(view.getFullYear(), view.getMonth(), day));
  }

  return (
    <div className="calendar-layout">
      <div className="calendar-grid">
        <div className="calendar-month-nav">
          <button type="button" className="outline-button" onClick={() => setCursor(current => (current ? shiftMonth(current, -1) : current))} aria-label="이전 달">이전</button>
          <strong>{monthLabel}</strong>
          <button type="button" className="outline-button" onClick={() => setCursor(current => (current ? shiftMonth(current, 1) : current))} aria-label="다음 달">다음</button>
        </div>
        <div className="week labels">{["월", "화", "수", "목", "금", "토", "일"].map(day => <span key={day}>{day}</span>)}</div>
        <div className="week dates calendar-dates">
          {cells.map((day, index) => {
            if (!day) return <span key={`pad-${index}`} />;
            const iso = isoFor(day);
            const isToday = iso === todayIso;
            const isSelected = iso === selected;
            const marks = [
              tripDays.has(iso) ? "여행" : "",
              dateStart === iso ? "데이트" : "",
              memories.some(item => item.happenedOn === iso) ? "추억" : "",
            ].filter(Boolean);
            return (
              <button
                type="button"
                className={`${isToday ? "today-cell" : ""} ${isSelected ? "is-selected" : ""} ${tripDays.has(iso) ? "trip-cell" : ""} ${dateStart === iso ? "date-cell" : ""}`}
                key={day}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                onClick={() => setSelected(iso)}
              >
                <b>{day}</b>
                {marks.slice(0, 2).map(mark => <small key={mark}>{mark}</small>)}
              </button>
            );
          })}
        </div>
      </div>
      <aside className="calendar-side">
        <article className="paper-card">
          <span className="eyebrow">SELECTED DAY</span>
          <h2>{selected ? formatKoDate(selected) : "날짜를 고르면 일정이 보여요"}</h2>
          {notice && <p className="form-hint">{notice}</p>}
          {selectedEvents.length ? selectedEvents.map(event => (
            <Link className="calendar-event" href={event.href} key={`${event.kind}-${event.title}`}>
              <span>{event.kind}</span>
              <b>{event.title}</b>
              <small>{event.detail}</small>
            </Link>
          )) : (
            <p className="form-hint">이 날에는 아직 붙은 일정이 없어요.</p>
          )}
          <div className="dialog-actions calendar-assign">
            {trip.items.length ? <button className="outline-button" type="button" onClick={() => void assign("trip")}>{tripStart ? "여행 시작일 바꾸기" : "여행 시작일로"}</button> : null}
            {date.items.length ? <button className="primary-button" type="button" onClick={() => void assign("date")}>{dateStart ? "데이트 날짜 바꾸기" : "데이트 날짜로"}</button> : null}
          </div>
        </article>
        <article className="paper-card">
          <span className="eyebrow">TRIP</span>
          <h2>{trip.items.length ? trip.title || "우리가 고른 여행" : "저장된 여행 없음"}</h2>
          <p>{trip.items.length ? `${trip.dayCount}일 · ${trip.items.length}곳${tripStart ? ` · ${formatKoShort(tripStart)}부터` : " · 시작일을 아직 안 붙였어요"}` : "장소를 담으면 여행 초안이 생겨요."}</p>
          <Link className="quiet-link" href="/trip">여행 보기 →</Link>
        </article>
        <article className="paper-card">
          <span className="eyebrow">DATE</span>
          <h2>{date.items.length ? date.title || "우리가 고른 데이트" : "저장된 데이트 없음"}</h2>
          <p>{date.items.length ? `${date.items.length}곳${dateStart ? ` · ${formatKoDate(dateStart)}` : " · 날짜를 아직 안 붙였어요"}` : "오후 일정도 같은 방식으로 만들 수 있어요."}</p>
          <Link className="quiet-link" href="/date">데이트 보기 →</Link>
        </article>
      </aside>
    </div>
  );
}
