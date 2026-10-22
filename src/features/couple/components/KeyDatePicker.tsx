"use client";

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import { formatKoDate } from "@/lib/dates";
import styles from "./KeyDatePicker.module.css";

export function KeyDatePicker({ value, onChange, label, max }: { value: string; onChange: (value: string) => void; label: string; max: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const titleId = useId();
  const dialog = useDialogFocus<HTMLDivElement>({ open, onClose: () => setOpen(false), initialFocus: '[aria-pressed="true"], [data-day]:not(:disabled)' });
  const cursor = month || (value || max).slice(0, 7);
  const [year, mon] = cursor.split("-").map(Number);
  const start = new Date(year, mon - 1, 1).getDay();
  const total = new Date(year, mon, 0).getDate();
  const isoFor = (day: number) => `${cursor}-${String(day).padStart(2, "0")}`;
  const choose = (iso: string) => { onChange(iso); setOpen(false); };
  const move = (delta: number) => {
    const date = new Date(year, mon - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (next >= "1900-01" && next <= max.slice(0, 7)) setMonth(next);
  };
  return <>
    <button className={styles.trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setMonth((value || max).slice(0, 7)); setOpen(true); }}>
      <span className={!value ? styles.placeholder : undefined}>{value ? formatKoDate(value) : "날짜를 골라 주세요"}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v5m8-5v5M4 11h16"/></svg>
    </button>
    {open && createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialog} tabIndex={-1} className={styles.picker} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header><div><span>DATES TO REMEMBER</span><h2 id={titleId}>{label}</h2></div><button type="button" aria-label="날짜 선택 닫기" onClick={() => setOpen(false)}>×</button></header>
        <div className={styles.navigation}>
          <button type="button" aria-label="이전 달" disabled={cursor <= "1900-01"} onClick={() => move(-1)}>‹</button>
          <div><select aria-label="연도" value={year} onChange={event => { const nextYear = Number(event.target.value); setMonth(`${nextYear}-${String(Math.min(mon, nextYear === Number(max.slice(0, 4)) ? Number(max.slice(5, 7)) : 12)).padStart(2, "0")}`); }}>{Array.from({ length: Number(max.slice(0, 4)) - 1899 }, (_, index) => Number(max.slice(0, 4)) - index).map(y => <option key={y} value={y}>{y}년</option>)}</select><select aria-label="월" value={mon} onChange={event => setMonth(`${year}-${event.target.value.padStart(2, "0")}`)}>{Array.from({length: year === Number(max.slice(0, 4)) ? Number(max.slice(5, 7)) : 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}</select></div>
          <button type="button" aria-label="다음 달" disabled={cursor >= max.slice(0, 7)} onClick={() => move(1)}>›</button>
        </div>
        <div className={styles.week} aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map(d => <span key={d}>{d}</span>)}</div>
        <div className={styles.days}>{Array.from({length:start}, (_,i) => <span key={`empty${i}`}/>)}{Array.from({length:total}, (_,i) => i + 1).map(day => <button key={day} type="button" data-day={day} aria-label={formatKoDate(isoFor(day))} aria-pressed={value === isoFor(day)} data-today={max === isoFor(day)} disabled={isoFor(day) > max} onClick={() => choose(isoFor(day))} onKeyDown={event => { const delta = ({ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7} as Record<string, number>)[event.key]; if (delta) { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>(`[data-day="${day + delta}"]:not(:disabled)`)?.focus(); } }}>{day}</button>)}</div>
        <footer><button type="button" onClick={() => choose("")}>날짜 지우기</button><button type="button" onClick={() => choose(max)}>오늘 선택</button></footer>
        <p>우리의 소중한 날을 한 장씩 남겨요.</p>
      </div>
    </div>, document.body)}
  </>;
}
