"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import { deleteArchivedTripPlan, updateArchivedTripPlan } from "../archiveActions";
import { tripDateRange } from "../tripDates";
import styles from "./TripDateWorkspace.module.css";

type ArchiveDialog = { mode: "edit" | "delete"; journey: ArchivedTripPlan };

export function TripArchivePanel({ journeys, notice, disabled = false, onOpen, onUpdated, onDeleted, onReload }: {
  journeys: ArchivedTripPlan[]; notice: string; disabled?: boolean;
  onOpen: (journey: ArchivedTripPlan) => void;
  onUpdated: (id: string, metadata: { title: string; notes: string }) => void;
  onDeleted: (id: string) => void;
  onReload: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<ArchiveDialog | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const close = () => { if (!busyRef.current) { setDialog(null); setError(""); setConflict(false); } };
  const dialogRef = useDialogFocus<HTMLFormElement>({ open: Boolean(dialog), onClose: close,
    initialFocus: dialog?.mode === "delete" ? "[data-dialog-cancel]" : undefined });

  function open(mode: ArchiveDialog["mode"], journey: ArchivedTripPlan) {
    if (disabled || busyRef.current) return;
    setTitle(journey.title); setNotes(journey.notes ?? ""); setError(""); setConflict(false);
    setDialog({ mode, journey });
  }

  async function submit() {
    if (!dialog || busyRef.current || disabled || dialog.mode === "edit" && !title.trim()) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (dialog.mode === "delete") {
        const result = await deleteArchivedTripPlan(dialog.journey.id);
        if ("error" in result) { setError(result.error); return; }
        onDeleted(dialog.journey.id);
      } else {
        const result = await updateArchivedTripPlan({ id: dialog.journey.id, title, notes,
          expected: { title: dialog.journey.title, notes: dialog.journey.notes ?? "" } });
        if ("error" in result) { setError(result.error); setConflict(Boolean(result.conflict)); return; }
        onUpdated(dialog.journey.id, { title: result.title, notes: result.notes });
      }
      setDialog(null); setConflict(false);
    } catch {
      setError("변경 결과를 확인하지 못했어요. 입력한 내용은 그대로 있으니 다시 시도해 주세요.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function reload() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await onReload(); setDialog(null); setError(""); setConflict(false); }
    catch { setError("최신 여행기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <>
    <section className={styles.archiveSection} aria-labelledby="trip-archive-heading">
      <header className={styles.archiveHead}>
        <div><span className={styles.archiveEyebrow}>PAST JOURNEYS</span><h2 id="trip-archive-heading">함께 다녀온 여행</h2><p>둘이 다녀온 곳과 남긴 이야기를 모았어요.</p></div>
        <span className={styles.archiveCount}>여행기록 <b>{journeys.length}</b></span>
      </header>
      {notice && <p className={styles.archiveNotice} role="status">{notice}</p>}
      {journeys.length ? <div className={styles.archiveGrid}>{journeys.map(journey => {
        const summary = `${journey.dayCount}일 · ${journey.items.length}곳`;
        const route = [...new Set(journey.items.map(item => item.placeName))].slice(0, 3);
        const hasNotes = Boolean(journey.notes?.trim() && journey.notes !== summary);
        return <article className={styles.archiveCard} key={journey.id}>
          <div className={styles.archiveCardTop}><span>{tripDateRange(journey.startDate, journey.dayCount)}</span><span className={styles.archiveBadge}>다녀온 여행</span></div>
          <h3>{journey.title}</h3>
          <div className={styles.archiveStats}><span>{journey.dayCount}일</span><span>장소 {journey.items.length}곳</span></div>
          <div className={styles.archiveCardBody}>
            {route.length > 0 && <div className={styles.archiveRoute}><span>방문한 곳</span><p>{route.join(" → ")}{journey.items.length > route.length ? " 외" : ""}</p></div>}
            {hasNotes && <p className={styles.archiveNotes}>{journey.notes}</p>}
            {!hasNotes && !route.length && <p className={styles.archiveEmptyNote}>남긴 이야기를 메모로 더해 보세요.</p>}
          </div>
          <div className={styles.archiveLinks}>
            <button className={styles.archiveOpen} type="button" disabled={disabled || busy}
              aria-label={`${journey.title} 여행기록 열기`} onClick={() => onOpen(journey)}>기록 열기 <span aria-hidden="true">↗</span></button>
            <Link className={styles.archiveMap} href="/our-map">기억 지도 <span aria-hidden="true">↗</span></Link>
          </div>
          <footer className={styles.archiveCardActions}><span>둘이 공유하는 기록</span><div>
            <button type="button" disabled={disabled || busy} aria-label={`${journey.title} 수정`} onClick={() => open("edit", journey)}>수정</button>
            <button className={styles.archiveDelete} type="button" disabled={disabled || busy} aria-label={`${journey.title} 삭제`} onClick={() => open("delete", journey)}>삭제</button>
          </div></footer>
        </article>;
      })}</div> : <div className={styles.archiveEmpty}><span aria-hidden="true">↗</span><h3>함께 남길 여행이 기다리고 있어요</h3><p>다녀온 코스에서 ‘여행기록 저장’을 누르면 이곳에 모여요.</p></div>}
    </section>
    {dialog && <div className="dialog-backdrop" onClick={close}>
      <form ref={dialogRef} tabIndex={-1} className={styles.archiveDialog} role="dialog" aria-modal="true" aria-labelledby="trip-archive-dialog-title"
        onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className={styles.archiveDialogHead}><div><span className={styles.archiveEyebrow}>TRAVEL RECORD</span><h2 id="trip-archive-dialog-title">{dialog.mode === "edit" ? "여행기록 수정" : "여행기록을 삭제할까요?"}</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={close}>×</button></div>
        {dialog.mode === "edit" ? <>
          <p className={styles.archiveDialogHint}>여행 제목과 메모를 수정해요. 기록한 날짜와 장소 순서는 그대로 유지됩니다.</p>
          <label className={styles.archiveField}><span>여행 제목</span><input data-dialog-autofocus required maxLength={500} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
          <label className={styles.archiveField}><span>여행 메모 <small>선택 사항</small></span><textarea rows={5} maxLength={20000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} placeholder="다녀온 곳에서 기억하고 싶은 이야기를 적어 주세요." /></label>
        </> : <div className={styles.archiveDeleteMessage}><b>{dialog.journey.title}</b><p>이 여행기록과 연결된 사진이 우리의기록과 기억 지도에서도 삭제됩니다. 삭제 후에는 되돌릴 수 없어요.</p><small>현재 편집 중인 여행 초안은 그대로 유지됩니다.</small></div>}
        {error && <p className={styles.archiveError} role="alert">{error}</p>}
        <div className={styles.archiveDialogActions}><button data-dialog-cancel type="button" disabled={busy} onClick={close}>취소</button>
          {conflict ? <button className={styles.archiveOpen} type="button" disabled={busy} onClick={() => void reload()}>최신 기록 불러오기</button>
            : <button className={dialog.mode === "delete" ? styles.archiveConfirmDelete : styles.archiveOpen} type="submit" disabled={busy || dialog.mode === "edit" && !title.trim()}>{busy ? "처리 중…" : dialog.mode === "edit" ? "변경 사항 저장" : "여행기록 삭제"}</button>}
        </div>
      </form>
    </div>}
  </>;
}
