"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { formatKoDate } from "@/lib/dates";
import { createNote, deleteNote, reorderNotes, updateNoteContent, updateNoteStatus } from "../actions";
import type { CoupleNote } from "../types";
import { noteCreationAttempt, type NoteCreationAttempt } from "../noteCreationAttempt";

type StatusOption = { id: string; label: string };

export function BucketWishBoard({
  notes,
  setNotes,
  visibleNotes,
  persist,
  statuses,
  completedStatusId,
  collaborators,
  onError,
  onRefresh,
  onOpenDialog,
  beginMutation,
  endMutation,
  busy,
}: {
  notes: CoupleNote[];
  setNotes: Dispatch<SetStateAction<CoupleNote[]>>;
  visibleNotes: CoupleNote[];
  persist: boolean;
  statuses: readonly StatusOption[];
  completedStatusId: string | undefined;
  collaborators?: { viewerId: string; viewerName: string; partnerName: string };
  onError: (message: string) => void;
  onRefresh: () => void;
  onOpenDialog: () => void;
  beginMutation: () => boolean;
  endMutation: () => void;
  busy: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickWhen, setQuickWhen] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editExtra, setEditExtra] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggedRef = useRef<string | null>(null);
  const editVersion = useRef<string | undefined>(undefined);
  const creationAttemptRef = useRef<NoteCreationAttempt | null>(null);
  const revealedHash = useRef("");
  const [linkedNoteId, setLinkedNoteId] = useState("");

  // The board arrives through Suspense, after the router's initial hash scroll.
  useEffect(() => {
    const revealLinkedNote = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#bucket-note-")) { revealedHash.current = ""; setLinkedNoteId(""); return; }
      if (revealedHash.current === hash) return;
      let id: string;
      try { id = decodeURIComponent(hash.slice("#bucket-note-".length)); } catch { return; }
      if (!notes.some(note => note.id === id)) return;
      const card = document.getElementById(`bucket-note-${id}`);
      if (!card) return;
      revealedHash.current = hash;
      setLinkedNoteId(id);
      card.scrollIntoView({ block: "center", behavior: "instant" });
      card.focus({ preventScroll: true });
    };
    revealLinkedNote();
    window.addEventListener("hashchange", revealLinkedNote);
    return () => window.removeEventListener("hashchange", revealLinkedNote);
  }, [notes]);

  const canReorder = persist && !busy && notes.length > 1 && visibleNotes.length === notes.length;
  const visibleIds = useMemo(() => new Set(visibleNotes.map(note => note.id)), [visibleNotes]);

  const { activeNotes, doneNotes } = useMemo(() => {
    const active: CoupleNote[] = [];
    const done: CoupleNote[] = [];
    for (const note of notes) {
      if (!visibleIds.has(note.id)) continue;
      if (hideDone && note.status === completedStatusId) continue;
      if (note.status === completedStatusId) done.push(note);
      else active.push(note);
    }
    return { activeNotes: active, doneNotes: done };
  }, [notes, visibleIds, hideDone, completedStatusId]);

  function authorLabel(note: CoupleNote) {
    if (!collaborators) return "우리";
    return note.createdBy === collaborators.viewerId ? collaborators.viewerName : collaborators.partnerName;
  }

  function isDragBlocked(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return true;
    return Boolean(target.closest("button, a, input, textarea, select, label, .bucket-card-edit"));
  }

  function dropItem(targetId: string) {
    const draggedId = draggedRef.current;
    draggedRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    if (!draggedId || draggedId === targetId) return;
    const from = notes.findIndex(note => note.id === draggedId);
    const to = notes.findIndex(note => note.id === targetId);
    if (from < 0 || to < 0) return;
    if (!beginMutation()) return;
    const snapshot = notes;
    const reordered = [...notes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setNotes(reordered);
    void reorderNotes("bucket", reordered.map(note => note.id))
      .catch(() => ({ error: "순서를 저장하지 못했어요. 연결을 확인해 주세요." }))
      .then(result => {
        endMutation();
        if ("error" in result) { setNotes(snapshot); onError(result.error); }
        onRefresh();
      });
  }

  function handleDragStart(event: DragEvent, noteId: string) {
    if (!canReorder || isDragBlocked(event.target)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", noteId);
    draggedRef.current = noteId;
    setDraggingId(noteId);
  }

  async function submitQuick(event: React.FormEvent) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    if (!persist) {
      onError("로그인 후 함께 적을 수 있어요.");
      return;
    }
    if (!beginMutation()) return;
    onError("");
    setPending(true);
    const input = {
      title,
      detail: "",
      extra: quickWhen.trim(),
      status: statuses[0].id,
    };
    creationAttemptRef.current = noteCreationAttempt(creationAttemptRef.current, "bucket", input);
    const result = await createNote("bucket", { ...input, attemptId: creationAttemptRef.current.id })
      .catch(() => ({ error: "저장 응답을 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요." }));
    endMutation();
    setPending(false);
    if ("error" in result) {
      onError(result.error);
      onRefresh();
      return;
    }
    creationAttemptRef.current = null;
    setNotes(current => [result.note, ...current.filter(note => note.id !== result.note.id)]);
    emitCoupleActivitiesChanged();
    setQuickTitle("");
    setQuickWhen("");
    onRefresh();
  }

  function changeStatus(note: CoupleNote, next: string) {
    if (next === note.status || !persist || !beginMutation()) return;
    onError("");
    const previous = note.status;
    setNotes(current => current.map(item => item.id === note.id ? { ...item, status: next } : item));
    void updateNoteStatus(note.id, next, note.updatedAt)
      .catch(() => ({ error: "상태를 저장하지 못했어요. 연결을 확인해 주세요." }))
      .then(result => {
        endMutation();
        if ("error" in result) {
          setNotes(current => current.map(item => item.id === note.id ? { ...item, status: previous } : item));
          onError(result.error);
        } else {
          setNotes(current => current.map(item => item.id === note.id ? result.note : item));
        }
        onRefresh();
      });
  }

  function toggleDone(note: CoupleNote) {
    const done = note.status === completedStatusId;
    changeStatus(note, done ? statuses[0].id : completedStatusId || statuses.at(-1)!.id);
  }

  function openEdit(note: CoupleNote) {
    editVersion.current = note.updatedAt;
    setExpandedId(note.id);
    setEditTitle(note.title);
    setEditDetail(note.detail);
    setEditExtra(note.extra);
  }

  async function saveEdit(note: CoupleNote) {
    if (!persist) {
      onError("로그인 후 수정할 수 있어요.");
      return;
    }
    if (!beginMutation()) return;
    onError("");
    setPending(true);
    const result = await updateNoteContent(note.id, { title: editTitle, detail: editDetail, extra: editExtra }, editVersion.current)
      .catch(() => ({ error: "메모를 저장하지 못했어요. 연결을 확인해 주세요." }));
    endMutation();
    setPending(false);
    if ("error" in result) {
      onError(result.error);
      onRefresh();
      return;
    }
    setNotes(current => current.map(item => item.id === note.id ? result.note : item));
    setExpandedId(null);
    onRefresh();
  }

  function removeNote(note: CoupleNote) {
    if (!persist || !beginMutation()) return;
    const snapshot = notes;
    setNotes(current => current.filter(item => item.id !== note.id));
    void deleteNote(note.id)
      .catch(() => ({ error: "삭제 응답을 확인하지 못했어요. 최신 목록을 확인해 주세요." }))
      .then(result => {
        endMutation();
        if ("error" in result) { setNotes(snapshot); onError(result.error); }
        onRefresh();
      });
  }

  function renderCard(note: CoupleNote, index: number) {
    const done = note.status === completedStatusId;
    const dragging = draggingId === note.id;
    const dropTarget = dropTargetId === note.id && draggingId !== note.id;
    const expanded = expandedId === note.id;

    return (
      <li
        key={note.id}
        id={`bucket-note-${note.id}`}
        tabIndex={-1}
        style={{ scrollMarginTop: "24px" }}
        className={`bucket-card status-${note.status}${linkedNoteId === note.id ? " is-linked" : ""}${done ? " is-done" : ""}${canReorder ? " is-reorderable" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}${expanded ? " is-expanded" : ""}`}
        draggable={canReorder}
        onDragStart={event => handleDragStart(event, note.id)}
        onDragEnd={() => {
          draggedRef.current = null;
          setDraggingId(null);
          setDropTargetId(null);
        }}
        onDragEnter={() => {
          if (draggingId && draggingId !== note.id) setDropTargetId(note.id);
        }}
        onDragOver={event => event.preventDefault()}
        onDrop={() => dropItem(note.id)}
      >
        <div className="bucket-card-main">
          <button
            className="bucket-check"
            type="button"
            disabled={busy || !persist}
            aria-label={done ? `${note.title} 완료 취소` : `${note.title} 완료로 표시`}
            aria-pressed={done}
            onClick={() => toggleDone(note)}
          >
            <span aria-hidden="true">✓</span>
          </button>
          <div className="bucket-card-body">
            <div className="bucket-card-title-row">
              <span className="bucket-card-index">{String(index + 1).padStart(2, "0")}</span>
              <h3>{note.title}</h3>
              {note.extra && !expanded && <span className="bucket-card-when">{note.extra}</span>}
            </div>
            {note.detail && !expanded && <p className="bucket-card-memo">{note.detail}</p>}
            <div className="bucket-card-meta">
              <span>{authorLabel(note)}</span>
              <span>{formatKoDate(note.createdAt.slice(0, 10))}</span>
            </div>
          </div>
          <div className="bucket-card-side">
            <select className="bucket-status-select" aria-label={`${note.title} 상태`} value={note.status}
              disabled={busy || !persist} onChange={event => changeStatus(note, event.target.value)}>
              {statuses.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <div className="bucket-card-tools">
              <button type="button" className="bucket-tool" disabled={busy || !persist} aria-label={`${note.title} 수정`} onClick={() => expanded ? setExpandedId(null) : openEdit(note)}>
                {expanded ? "닫기" : "수정"}
              </button>
              <button type="button" className="bucket-tool is-danger" disabled={busy} aria-label={`${note.title} 지우기`} onClick={() => removeNote(note)}>지우기</button>
            </div>
          </div>
        </div>
        {expanded && (
          <form
            className="bucket-card-edit"
            onSubmit={event => {
              event.preventDefault();
              void saveEdit(note);
            }}
          >
            <label className="bucket-edit-title"><span>함께 해보고 싶은 일</span><input required maxLength={140} value={editTitle} onChange={event => setEditTitle(event.target.value)} disabled={busy} /></label>
            <label>
              <span>이루고 싶은 이유 · 계획</span>
              <textarea value={editDetail} maxLength={4000} disabled={busy} onChange={event => setEditDetail(event.target.value)} rows={3} placeholder="왜 해보고 싶은지, 어떻게 준비할지 적어 보세요." />
            </label>
            <label>
              <span>언제쯤</span>
              <input value={editExtra} maxLength={4096} disabled={busy} onChange={event => setEditExtra(event.target.value)} placeholder="올해 겨울, 2주년 전후" />
            </label>
            <div className="bucket-card-edit-actions">
              <button type="button" className="outline-button" onClick={() => setExpandedId(null)} disabled={busy}>취소</button>
              <button type="submit" className={`primary-button${pending ? " is-loading" : ""}`} disabled={busy || !editTitle.trim()} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}
      </li>
    );
  }

  return (
    <section className="bucket-paper bucket-paper-v2" aria-label="함께 쓰는 버킷리스트">
      <form className="bucket-quick-add" onSubmit={event => void submitQuick(event)}>
        <span className="bucket-quick-icon" aria-hidden="true">+</span>
        <div className="bucket-quick-fields">
          <input
            value={quickTitle}
            maxLength={140}
            onChange={event => setQuickTitle(event.target.value)}
            placeholder="둘이 함께 해보고 싶은 일을 적어 보세요"
            aria-label="새 버킷리스트 항목"
            disabled={busy}
          />
          <input
            value={quickWhen}
            maxLength={4096}
            onChange={event => setQuickWhen(event.target.value)}
            placeholder="언제쯤 (선택)"
            aria-label="목표 시기"
            disabled={busy}
          />
        </div>
        <button type="submit" disabled={busy || !quickTitle.trim()}>{pending ? "추가 중" : "추가"}</button>
      </form>

      <div className="bucket-board-bar">
        <label className="bucket-hide-done">
          <input type="checkbox" checked={hideDone} onChange={event => setHideDone(event.target.checked)} />
          <span>완료한 항목 접기</span>
        </label>
        {canReorder && <p className="bucket-reorder-hint" role="status">끌어서 순서 변경</p>}
      </div>

      {!notes.length ? (
        <div className="bucket-empty">
          <b>첫 번째 버킷리스트를 기다리고 있어요</b>
          <p>작은 일부터 크게 꿈꾸는 일까지, 한 줄로 시작해 보세요.</p>
        </div>
      ) : !activeNotes.length && !doneNotes.length ? (
        <div className="bucket-empty is-filtered">
          <b>조건에 맞는 항목이 없어요</b>
          <p>필터를 바꾸거나 검색어를 지워 보세요.</p>
        </div>
      ) : (
        <div className="bucket-card-stack">
          {activeNotes.length > 0 && (
            <ol className="bucket-lines bucket-lines-v2">
              {activeNotes.map((note, index) => renderCard(note, index))}
            </ol>
          )}
          {doneNotes.length > 0 && (
            <>
              <div className="bucket-done-divider">
                <span>완료한 장면</span>
                <b>{doneNotes.length}</b>
              </div>
              <ol className="bucket-lines bucket-lines-v2 is-done-section">
                {doneNotes.map((note, index) => renderCard(note, activeNotes.length + index))}
              </ol>
            </>
          )}
        </div>
      )}

      <footer className="bucket-paper-foot">
        <span>ONLY US</span>
        <button type="button" disabled={busy} onClick={onOpenDialog}>메모와 함께 자세히 추가</button>
      </footer>
    </section>
  );
}
