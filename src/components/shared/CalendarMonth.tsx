"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, toIsoDate } from "@/lib/dates";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthKey(value: string) {
  if (value.length >= 7) return value.slice(0, 7);
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthDate(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function CalendarMonth({
  value,
  dayCount = 1,
  markedDates = [],
  markedLabels = {},
  onSelect,
}: {
  value: string;
  dayCount?: number;
  markedDates?: readonly string[];
  markedLabels?: Readonly<Record<string, string>>;
  onSelect: (iso: string) => void;
}) {
  const [cursor, setCursor] = useState(() => monthKey(value));
  const view = monthDate(cursor);
  const marked = useMemo(() => new Set(markedDates), [markedDates]);
  const labels = useMemo(() => new Map(Object.entries(markedLabels)), [markedLabels]);
  const today = useMemo(() => toIsoDate(new Date()), []);
  const range = useMemo(() => {
    if (!value) return new Set<string>();
    return new Set(Array.from({ length: Math.max(1, dayCount) }, (_, index) => addDays(value, index)));
  }, [value, dayCount]);
  const rangeEnd = value && dayCount > 1 ? addDays(value, dayCount - 1) : value;

  useEffect(() => {
    if (value) setCursor(monthKey(value));
  }, [value]);

  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [view]);

  const shiftMonth = (amount: number) => {
    const next = new Date(view.getFullYear(), view.getMonth() + amount, 1);
    setCursor(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="calendar-month">
      <div className="date-popover-head">
        <button type="button" aria-label="이전 달" onClick={() => shiftMonth(-1)}>‹</button>
        <strong>{view.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}</strong>
        <button type="button" aria-label="다음 달" onClick={() => shiftMonth(1)}>›</button>
      </div>
      <div className="date-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
      <div className="date-days">
        {days.map(date => {
          const iso = toIsoDate(date);
          const planned = marked.has(iso);
          const plannedLabel = labels.get(iso);
          const selected = iso === value;
          const inRange = range.has(iso);
          return (
            <button
              type="button"
              key={iso}
              className={[
                sameMonth(date, view) ? "" : "is-outside",
                selected ? "is-selected" : "",
                iso === today ? "is-today" : "",
                planned ? "is-planned" : "",
                inRange ? "is-in-range" : "",
                selected && dayCount > 1 ? "is-range-start" : "",
                iso === rangeEnd && dayCount > 1 ? "is-range-end" : "",
              ].filter(Boolean).join(" ")}
              aria-pressed={selected}
              aria-label={`${date.getDate()}일${inRange && dayCount > 1 ? ", 여행 일정" : planned ? `, ${plannedLabel || "데이트 있음"}` : ""}`}
              onClick={() => onSelect(iso)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
