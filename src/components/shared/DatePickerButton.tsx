"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatKoPicker, toIsoDate } from "@/lib/dates";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthStart(value: string) {
  const parsed = value ? new Date(`${value}T12:00:00`) : new Date();
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function DatePickerButton({
  value,
  emptyLabel,
  onChange,
  ariaLabel,
}: {
  value: string;
  emptyLabel: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthStart(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => toIsoDate(new Date()), []);

  useEffect(() => {
    if (value) setView(monthStart(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

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

  const shiftMonth = (amount: number) => setView(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const select = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div className="date-picker-wrap" ref={rootRef}>
      <button
        className={`date-picker ${value ? "" : "is-empty"} ${open ? "is-open" : ""}`}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <svg className="date-picker-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M7.5 3.5v3.8M16.5 3.5v3.8M3.5 9.5h17" />
          <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
        </svg>
        <span>{value ? formatKoPicker(value) : emptyLabel}</span>
        <svg className="date-picker-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open && (
        <div className="date-popover" role="dialog" aria-label={`${ariaLabel} 선택`}>
          <div className="date-popover-head">
            <button type="button" aria-label="이전 달" onClick={() => shiftMonth(-1)}>‹</button>
            <strong>{view.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}</strong>
            <button type="button" aria-label="다음 달" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="date-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
          <div className="date-days">
            {days.map(date => {
              const iso = toIsoDate(date);
              return (
                <button
                  type="button"
                  key={iso}
                  className={`${sameMonth(date, view) ? "" : "is-outside"} ${iso === value ? "is-selected" : ""} ${iso === today ? "is-today" : ""}`}
                  aria-pressed={iso === value}
                  onClick={() => select(iso)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="date-popover-foot">
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>날짜 지우기</button>
            <button type="button" onClick={() => { setView(monthStart(today)); select(today); }}>오늘</button>
          </div>
        </div>
      )}
    </div>
  );
}
