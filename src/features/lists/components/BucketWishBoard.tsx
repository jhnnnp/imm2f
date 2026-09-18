"use client";

import { useMemo, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { formatKoDate } from "@/lib/dates";
import { createNote, deleteNote, reorderNotes, updateNoteContent, updateNoteStatus } from "../actions";
import type { CoupleNote } from "../types";

type StatusOption = { id: string; label: string };

export function BucketWishBoard({
  notes,
  setNotes,
  visibleNotes,
  persist,
  statuses,
  completedStatusId,
  collaborators,
  progress,
  doneCount,
  onError,
  onRefresh,
  onOpenDialog,
}: {
  notes: CoupleNote[];
  setNotes: Dispatch<SetStateAction<CoupleNote[]>>;
  visibleNotes: CoupleNote[];
  persist: boolean;
  statuses: readonly StatusOption[];
  completedStatusId: string | undefined;
  collaborators?: { viewerId: string; viewerName: string; partnerName: string };
  progress: number;
  doneCount: number;
  onError: (message: string) => void;
  onRefresh: () => void;
  onOpenDialog: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickWhen, setQuickWhen] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editDetail, setEditDetail] = useState("");
  const [editExtra, setEditExtra] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggedRef = useRef<string | null>(null);

  const canReorder = persist && notes.length > 1 && visibleNotes.length === notes.length;
  const visibleIds = useMemo(() => new Set(visibleNotes.map(note => note.id)), [visibleNotes]);

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(statuses.map(item => [item.id, 0])) as Record<string, number>;
    for (const note of notes) counts[note.status] = (counts[note.status] ?? 0) + 1;
    return counts;
  }, [notes, statuses]);

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
    const snapshot = notes;
    const reordered = [...notes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setNotes(reordered);
    void reorderNotes("bucket", reordered.map(note => note.id)).then(result => {
      if ("error" in result) {
        setNotes(snapshot);
        onError(result.error);
      } else {
        onRefresh();
      }
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
    setPending(true);
    const result = await createNote("bucket", {
      title,
      detail: "",
      extra: quickWhen.trim(),
      status: statuses[0].id,
    });
    setPending(false);
    if ("error" in result) {
      onError(result.error);
      return;
    }
    setNotes(current => [result.note, ...current]);
    emitCoupleActivitiesChanged();
    setQuickTitle("");
    setQuickWhen("");
    onRefresh();
  }

  function changeStatus(note: CoupleNote, next: string) {
    if (next === note.status) return;
    const previous = note.status;
    setNotes(current => current.map(item => item.id === note.id ? { ...item, status: next } : item));
    void updateNoteStatus(note.id, next).then(result => {
      if ("error" in result) {
        setNotes(current => current.map(item => item.id === note.id ? { ...item, status: previous } : item));
        onError(result.error);
      } else {
        onRefresh();
      }
    });
  }

  function toggleDone(note: CoupleNote) {
    const done = note.status === completedStatusId;
    changeStatus(note, done ? statuses[0].id : completedStatusId || statuses.at(-1)!.id);
  }

  function openEdit(note: CoupleNote) {
    setExpandedId(note.id);
    setEditDetail(note.detail);
    setEditExtra(note.extra);
  }

  async function saveEdit(note: CoupleNote) {
    if (!persist) {
      onError("로그인 후 수정할 수 있어요.");
      return;
    }
    setPending(true);
    const result = await updateNoteContent(note.id, { detail: editDetail, extra: editExtra });
    setPending(false);
    if ("error" in result) {
      onError(result.error);
      return;
    }
    setNotes(current => current.map(item => item.id === note.id ? result.note : item));
    setExpandedId(null);
    onRefresh();
  }

  function removeNote(note: CoupleNote) {
    const removedIndex = notes.findIndex(item => item.id === note.id);
    setNotes(current => current.filter(item => item.id !== note.id));
    void deleteNote(note.id).then(result => {
      if ("error" in result) {
        setNotes(current => [...current.slice(0, removedIndex), note, ...current.slice(removedIndex)]);
        onError(result.error);
      } else {
        onRefresh();
      }
    });
  }

  function renderCard(note: CoupleNote, index: number) {
    const done = note.status === completedStatusId;
    const dragging = draggingId === note.id;
    const dropTarget = dropTargetId === note.id && draggingId !== note.id;
    const expanded = expandedId === note.id;
    const statusIndex = Math.max(0, statuses.findIndex(item => item.id === note.status));

    return (
      <li
        key={note.id}
        className={`bucket-card status-${note.status}${done ? " is-done" : ""}${canReorder ? " is-reorderable" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}${expanded ? " is-expanded" : ""}`}
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
            <div className="bucket-status-pills" role="group" aria-label={`${note.title} 상태`}>
              {statuses.map((item, pillIndex) => (
                <button
                  key={item.id}
                  type="button"
                  className={note.status === item.id ? "is-active" : ""}
                  aria-pressed={note.status === item.id}
                  onClick={() => changeStatus(note, item.id)}
                >
                  <i className={`status-tone status-tone-${pillIndex}`} aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>
            <div className="bucket-card-tools">
              <button type="button" className="bucket-tool" onClick={() => expanded ? setExpandedId(null) : openEdit(note)}>
                {expanded ? "닫기" : "메모"}
              </button>
              <button type="button" className="bucket-tool is-danger" aria-label={`${note.title} 지우기`} onClick={() => removeNote(note)}>지우기</button>
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
            <label>
              <span>이루고 싶은 이유 · 계획</span>
              <textarea value={editDetail} onChange={event => setEditDetail(event.target.value)} rows={3} placeholder="왜 해보고 싶은지, 어떻게 준비할지 적어 보세요." />
            </label>
            <label>
              <span>언제쯤</span>
              <input value={editExtra} onChange={event => setEditExtra(event.target.value)} placeholder="올해 겨울, 2주년 전후" />
            </label>
            <div className="bucket-card-edit-actions">
              <button type="button" className="outline-button" onClick={() => setExpandedId(null)} disabled={pending}>취소</button>
              <button type="submit" className="primary-button" disabled={pending}>{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}
        <span className={`bucket-card-accent status-tone-${statusIndex}`} aria-hidden="true" />
      </li>
    );
  }

  return (
    <section className="bucket-paper bucket-paper-v2" aria-label="함께 쓰는 버킷리스트">
      <header className="bucket-paper-head">
        <div className="bucket-head-copy">
          <span className="bucket-kicker">OUR WISH LIST</span>
          <h2>우리의 다음 장면들</h2>
          <p>꿈을 적고, 계획하고, 이룬 날엔 체크해요. 메모와 목표 시기도 함께 남길 수 있어요.</p>
        </div>
        <div className="bucket-head-panel">
          <div className="bucket-collaborators" aria-label="함께 작성하는 사람">
            <span>{collaborators?.viewerName.slice(0, 1) || "나"}</span>
            <span>{collaborators?.partnerName.slice(0, 1) || "?"}</span>
            <small>
              <b>함께 쓰는 목록</b>
              {collaborators ? `${collaborators.viewerName} · ${collaborators.partnerName}` : "우리의 공간"}
            </small>
          </div>
          <div className="bucket-stat-grid" aria-label="상태별 개수">
            {statuses.map((item, index) => (
              <div key={item.id}>
                <i className={`status-tone status-tone-${index}`} aria-hidden="true" />
                <b>{statusCounts[item.id] ?? 0}</b>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="bucket-paper-progress" aria-label={`버킷리스트 달성률 ${progress}%`}>
            <span><b>{doneCount}</b> / {notes.length || 0} 완료</span>
            <i><b style={{ width: `${progress}%` }} /></i>
            <strong>{progress}%</strong>
          </div>
        </div>
      </header>

      <div className="bucket-board-bar">
        <label className="bucket-hide-done">
          <input type="checkbox" checked={hideDone} onChange={event => setHideDone(event.target.checked)} />
          <span>완료한 항목 접기</span>
        </label>
        {canReorder && <p className="bucket-reorder-hint" role="status">카드를 끌어 순서를 바꿀 수 있어요.</p>}
      </div>

      <form className="bucket-quick-add" onSubmit={event => void submitQuick(event)}>
        <span className="bucket-quick-icon" aria-hidden="true">+</span>
        <div className="bucket-quick-fields">
          <input
            value={quickTitle}
            onChange={event => setQuickTitle(event.target.value)}
            placeholder="둘이 함께 해보고 싶은 일을 적어 보세요"
            aria-label="새 버킷리스트 항목"
          />
          <input
            value={quickWhen}
            onChange={event => setQuickWhen(event.target.value)}
            placeholder="언제쯤 (선택)"
            aria-label="목표 시기"
          />
        </div>
        <button type="submit" disabled={pending || !quickTitle.trim()}>{pending ? "추가 중" : "추가"}</button>
      </form>

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
        <button type="button" onClick={onOpenDialog}>메모와 함께 자세히 추가</button>
      </footer>
    </section>
  );
}
