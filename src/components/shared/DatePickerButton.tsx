"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarMonth } from "@/components/shared/CalendarMonth";
import { formatKoPicker, toIsoDate } from "@/lib/dates";

export function DatePickerButton({
  value,
  emptyLabel,
  onChange,
  ariaLabel,
  markedDates = [],
  markedLabels = {},
}: {
  value: string;
  emptyLabel: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  markedDates?: readonly string[];
  markedLabels?: Readonly<Record<string, string>>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => toIsoDate(new Date()), []);

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
          <CalendarMonth
            value={value}
            markedDates={markedDates}
            markedLabels={markedLabels}
            onSelect={select}
          />
          <div className="date-popover-foot">
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>날짜 지우기</button>
            <button type="button" onClick={() => { select(today); }}>오늘</button>
          </div>
          {markedDates.length > 0 && <p className="date-popover-hint">색이 있는 날은 이미 짠 데이트예요. 다른 날을 고르면 이 날은 그대로 둡니다.</p>}
        </div>
      )}
    </div>
  );
}
