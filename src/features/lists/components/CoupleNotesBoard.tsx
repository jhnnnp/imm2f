"use client";

import { useState } from "react";
import { formatKoDate } from "@/lib/dates";
import { createNote, deleteNote, updateNoteStatus } from "../actions";
import { NOTE_COPY, NOTE_STATUS, type CoupleNote, type NoteKind } from "../types";

export function CoupleNotesBoard({
  kind,
  initialNotes,
  persist,
}: {
  kind: NoteKind;
  initialNotes: CoupleNote[];
  persist: boolean;
}) {
  const copy = NOTE_COPY[kind];
  const statuses = NOTE_STATUS[kind];
  const [notes, setNotes] = useState(initialNotes);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [extra, setExtra] = useState("");
  const [status, setStatus] = useState(statuses[0].id);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!persist) {
      setError("로그인 후 저장할 수 있어요.");
      return;
    }
    setPending(true);
    setError("");
    const result = await createNote(kind, { title, detail, extra, status });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setNotes(current => [result.note, ...current]);
    setOpen(false);
    setTitle("");
    setDetail("");
    setExtra("");
    setStatus(statuses[0].id);
  }

  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setOpen(true)}>새로 남기기</button>
      </div>
      {!persist && <p className="inline-notice" role="status">로그인하면 둘이 같은 목록을 봐요. <a href="/login">로그인</a></p>}
      {!notes.length ? (
        <div className="empty-soft">
          <h1>아직 비어 있어요</h1>
          <p>{copy.lead}</p>
          <button className="primary-button" type="button" onClick={() => setOpen(true)}>첫 기록 남기기</button>
        </div>
      ) : (
        <ul className="note-list">
          {notes.map(note => (
            <li key={note.id}>
              <div>
                <span>{statuses.find(item => item.id === note.status)?.label ?? note.status}</span>
                <h2>{note.title}</h2>
                {note.detail && <p>{note.detail}</p>}
                {note.extra && <p className="note-extra">{note.extra}</p>}
                <small>{formatKoDate(note.createdAt.slice(0, 10))}</small>
              </div>
              <div className="note-actions">
                <select
                  value={note.status}
                  aria-label={`${note.title} 상태`}
                  onChange={event => {
                    const next = event.target.value;
                    setNotes(current => current.map(item => item.id === note.id ? { ...item, status: next } : item));
                    void updateNoteStatus(note.id, next);
                  }}
                >
                  {statuses.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
                <button className="text-link" type="button" onClick={() => {
                  setNotes(current => current.filter(item => item.id !== note.id));
                  void deleteNote(note.id);
                }}>지우기</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !pending && setOpen(false)}>
          <form className="place-create-dialog" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div>
                <span className="eyebrow">NEW</span>
                <h2>기록 남기기</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
            </div>
            <label className="field">
              <span>제목</span>
              <input value={title} onChange={event => setTitle(event.target.value)} placeholder={copy.placeholder} required />
            </label>
            <label className="field">
              <span>짧은 설명</span>
              <textarea value={detail} onChange={event => setDetail(event.target.value)} rows={4} />
            </label>
            <label className="field">
              <span>{copy.extra}</span>
              <input value={extra} onChange={event => setExtra(event.target.value)} placeholder={copy.extraPh} />
            </label>
            <label className="field">
              <span>상태</span>
              <select value={status} onChange={event => setStatus(event.target.value)}>
                {statuses.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={() => setOpen(false)} disabled={pending}>취소</button>
              <button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
