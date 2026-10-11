"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import styles from "./PlacesTripDialog.module.css";

export function PlacesTripDialog({ names, initialDate, initialDay, onClose, onSubmit }: {
  names: string[]; initialDate: string; initialDay: number; onClose: () => void;
  onSubmit: (input: { targetDate: string; dayIndex: number; spread: boolean }) => Promise<{ error?: string }>;
}) {
  const [date, setDate] = useState(initialDate);
  const [day, setDay] = useState(initialDay);
  const [spread, setSpread] = useState(names.length > 5);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLFormElement>({ open: true, onClose: () => { if (!locked.current) onClose(); } });
  async function submit() {
    if (locked.current) return;
    locked.current = true; setPending(true); setError("");
    try {
      const result = await onSubmit({ targetDate: date, dayIndex: day, spread });
      if (result.error) setError(result.error); else onClose();
    } catch { setError("추가 결과를 확인하지 못했어요. 여행을 확인한 뒤 다시 시도해 주세요."); }
    finally { locked.current = false; setPending(false); }
  }
  return createPortal(<div className="dialog-backdrop" onClick={event => { if (event.target === event.currentTarget && !locked.current) onClose(); }}>
    <form ref={dialogRef} tabIndex={-1} className={`place-create-dialog ${styles.dialog}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={pending} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className={styles.heading}><div><span className="eyebrow">TO OUR TRIP</span><h2 id={titleId}>선택한 {names.length}곳을 여행에 담기</h2></div><button className="icon-button" type="button" aria-label="여행 추가 창 닫기" disabled={pending} onClick={onClose}>×</button></div>
      <div className={styles.places}>{names.slice(0, 3).map((name, index) => <span key={`${index}:${name}`}>{name}</span>)}{names.length > 3 && <span>외 {names.length - 3}곳</span>}</div>
      <div className={styles.destination}>
        <label className="field"><span>여행 시작일</span><input type="date" value={date} disabled={pending} onChange={event => setDate(event.target.value)} /></label>
        <label className="field"><span>추가할 일차</span><select value={day} disabled={pending} onChange={event => setDay(Number(event.target.value))}>{Array.from({ length: 7 }, (_, value) => <option key={value} value={value}>DAY {value + 1}</option>)}</select></label>
      </div>
      <p className={styles.hint}>{date ? "해당 시작일의 여행에 추가해요. 기존 일정은 유지돼요." : "날짜 미정 여행에 추가해요."}</p>
      <fieldset className={styles.arrangement} disabled={pending}><legend>장소 배치</legend>
        <label><input type="radio" checked={!spread} onChange={() => setSpread(false)} name={`${titleId}-arrange`} /><span><b>한 일차에 추가</b><small>목록 순서대로 같은 날에 담아요.</small></span></label>
        <label><input type="radio" checked={spread} onChange={() => setSpread(true)} name={`${titleId}-arrange`} /><span><b>여러 일차에 나누기</b><small>선택한 날부터 하루 5곳을 기준으로 나눠요.</small></span></label>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="outline-button" type="button" disabled={pending} onClick={onClose}>취소</button><button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending}>{pending ? "여행에 담는 중…" : `${names.length}곳 여행에 추가`}</button></div>
    </form>
  </div>, document.body);
}
