"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { formatKoDate } from "@/lib/dates";
import { createNote, deleteNote, reorderNotes, updateNoteStatus } from "../actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { VaultScreenshotImport } from "./VaultScreenshotImport";
import { BucketWishBoard } from "./BucketWishBoard";
import { NOTE_COPY, NOTE_STATUS, type CoupleNote, type NoteKind } from "../types";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";

const KIND_META: Record<NoteKind, {
  kicker: string;
  addLabel: string;
  dialogTitle: string;
  titleLabel: string;
  detailLabel: string;
  collectionLabel: string;
  emptyTitle: string;
  emptyDescription: string;
}> = {
  vault: {
    kicker: "우리의  중요한 정보를 안전하게 한곳에",
    addLabel: "보관하기",
    dialogTitle: "보관함에 추가",
    titleLabel: "무엇을 보관할까요?",
    detailLabel: "설명 또는 메모",
    collectionLabel: "보관함",
    emptyTitle: "첫 번째 정보를 보관해 보세요",
    emptyDescription: "예약번호나 링크처럼 다시 찾아볼 정보를 한곳에 모을 수 있어요.",
  },
  gift: {
    kicker: "아이디어부터 전한 순간까지",
    addLabel: "선물 추가",
    dialogTitle: "선물 계획 추가",
    titleLabel: "어떤 선물인가요?",
    detailLabel: "아이디어와 준비 메모",
    collectionLabel: "선물 목록",
    emptyTitle: "마음을 전할 아이디어를 담아보세요",
    emptyDescription: "작은 아이디어도 기록해 두면 특별한 날을 놓치지 않아요.",
  },
  bucket: {
    kicker: "함께 꿈꾸고, 계획하고, 이루는 목록",
    addLabel: "한 줄 추가",
    dialogTitle: "새로운 꿈 추가",
    titleLabel: "둘이 무엇을 해볼까요?",
    detailLabel: "이루고 싶은 이유나 계획",
    collectionLabel: "버킷리스트",
    emptyTitle: "함께 이루고 싶은 일을 적어보세요",
    emptyDescription: "가고 싶은 곳부터 사소한 도전까지, 우리의다음 장면을 시작해요.",
  },
};

function NoteKindIcon({ kind }: { kind: NoteKind }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {kind === "vault" && <><rect x="3.5" y="4" width="17" height="16" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M12 9v6M9 12h6" /></>}
      {kind === "gift" && <><path d="M3.5 9h17v11h-17zM2.5 6h19v3h-19zM12 6v14" /><path d="M12 6H8.8A2.3 2.3 0 1 1 11 3.1L12 6Zm0 0h3.2A2.3 2.3 0 1 0 13 3.1L12 6Z" /></>}
      {kind === "bucket" && <><path d="M6 9.5V6a6 6 0 0 1 12 0v3.5M4 8h16l-1 13H5L4 8Z" /><path d="M9 12v4M15 12v4" /></>}
    </svg>
  );
}

function isWebLink(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function linkHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "상품 페이지";
  }
}

type LinkMetadata = { url: string; host: string; title: string; description: string; image: string; siteName: string };

function GiftLinkPreview({ url, mode = "card" }: { url: string; mode?: "card" | "editor" | "detail" }) {
  const [metadata, setMetadata] = useState<LinkMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = isWebLink(url);

  useEffect(() => {
    if (!valid) {
      setMetadata(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() as Promise<LinkMetadata> : Promise.reject())
        .then(setMetadata)
        .catch(() => setMetadata(null))
        .finally(() => setLoading(false));
    }, mode === "editor" ? 450 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [mode, url, valid]);

  if (!valid) return mode === "editor" ? (
    <div className="gift-preview-empty"><span>↗</span><b>링크를 붙여 넣어 보세요</b><p>대표 이미지와 상품 정보를 불러와<br />구매 후보 카드로 정리해 드려요.</p></div>
  ) : null;

  if (mode === "card") {
    return (
      <a className={`gift-rich-card ${metadata?.image ? "has-image" : ""}`} href={url} target="_blank" rel="noreferrer">
        <div className="gift-rich-visual">{metadata?.image ? <img src={metadata.image} alt="" /> : <span>{linkHost(url).slice(0, 1).toUpperCase()}</span>}</div>
        <div><small>{metadata?.siteName || linkHost(url)}</small><b>{loading ? "상품 정보를 불러오는 중…" : metadata?.title || "상품 페이지 보기"}</b></div><em>↗</em>
      </a>
    );
  }

  return (
    <div className={`gift-metadata-preview ${metadata?.image ? "has-image" : ""}`}>
      <div className="gift-metadata-image">{metadata?.image ? <img src={metadata.image} alt="상품 대표 이미지" /> : <span>{loading ? "…" : linkHost(url).slice(0, 1).toUpperCase()}</span>}</div>
      <div className="gift-metadata-copy"><small>{metadata?.siteName || linkHost(url)}</small><h3>{loading ? "상품 정보를 불러오는 중이에요" : metadata?.title || "상품 페이지가 연결됐어요"}</h3>{metadata?.description && <p>{metadata.description}</p>}<a href={url} target="_blank" rel="noreferrer">상품 페이지 열기 <span>↗</span></a></div>
    </div>
  );
}

export function CoupleNotesBoard({
  kind,
  initialNotes,
  persist,
  collaborators,
}: {
  kind: NoteKind;
  initialNotes: CoupleNote[];
  persist: boolean;
  collaborators?: { viewerId: string; viewerName: string; partnerName: string };
}) {
  const copy = NOTE_COPY[kind];
  const router = useRouter();
  const meta = KIND_META[kind];
  const statuses = NOTE_STATUS[kind];
  const [notes, setNotes] = useState(initialNotes);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [extra, setExtra] = useState("");
  const [status, setStatus] = useState(statuses[0].id);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<CoupleNote | null>(null);
  const [vaultScanPreview, setVaultScanPreview] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dropTargetNoteId, setDropTargetNoteId] = useState<string | null>(null);
  const draggedNoteRef = useRef<string | null>(null);

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const onVaultPreviewChange = useCallback((preview: boolean) => {
    setVaultScanPreview(preview);
  }, []);

  function closeDialog() {
    setOpen(false);
    setVaultScanPreview(false);
    setError("");
  }

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return notes.filter(note => {
      if (filter !== "all" && note.status !== filter) return false;
      if (!normalized) return true;
      return [note.title, note.detail, note.extra].some(value => value.toLocaleLowerCase("ko-KR").includes(normalized));
    });
  }, [filter, notes, query]);

  const completedStatus = statuses.at(-1)?.id;
  const highlightStatus = kind === "vault" ? statuses[0].id : completedStatus;
  const highlightCount = notes.filter(note => note.status === highlightStatus).length;
  const progress = notes.length ? Math.round((highlightCount / notes.length) * 100) : 0;
  const highlightUnit = kind === "vault" ? "개의 보관" : kind === "gift" ? "개의 전달" : "개의 달성";
  const canReorderNotes = persist && kind === "vault" && filter === "all" && !query.trim() && notes.length > 1;

  function dropNote(targetId: string) {
    const draggedId = draggedNoteRef.current;
    draggedNoteRef.current = null;
    setDraggingNoteId(null);
    setDropTargetNoteId(null);
    if (!draggedId || draggedId === targetId) return;
    const from = notes.findIndex(note => note.id === draggedId);
    const to = notes.findIndex(note => note.id === targetId);
    if (from < 0 || to < 0) return;
    const snapshot = notes;
    const reordered = [...notes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setNotes(reordered);
    void reorderNotes(kind, reordered.map(note => note.id)).then(result => {
      if ("error" in result) {
        setNotes(snapshot);
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function isNoteDragBlocked(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return true;
    return Boolean(target.closest("button, a, input, select, textarea, label, [role=menu], .note-status-menu"));
  }

  function handleNoteDragStart(event: DragEvent, noteId: string) {
    if (!canReorderNotes || isNoteDragBlocked(event.target)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", noteId);
    draggedNoteRef.current = noteId;
    setDraggingNoteId(noteId);
  }

  function handleNoteDragEnd() {
    draggedNoteRef.current = null;
    setDraggingNoteId(null);
    setDropTargetNoteId(null);
  }

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
    emitCoupleActivitiesChanged();
    closeDialog();
    setTitle("");
    setDetail("");
    setExtra("");
    setStatus(statuses[0].id);
    router.refresh();
  }

  function changeStatus(note: CoupleNote, next: string) {
    if (next === note.status) {
      setOpenStatusId(null);
      return;
    }
    const previous = note.status;
    setOpenStatusId(null);
    setNotes(current => current.map(item => item.id === note.id ? { ...item, status: next } : item));
    void updateNoteStatus(note.id, next).then(result => {
      if ("error" in result) {
        setNotes(current => current.map(item => item.id === note.id ? { ...item, status: previous } : item));
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function renderNoteCard(note: CoupleNote, index: number) {
    const dragging = draggingNoteId === note.id;
    const dropTarget = dropTargetNoteId === note.id && draggingNoteId !== note.id;
    return (
      <li
        key={note.id}
        className={`${note.status === completedStatus ? "is-complete" : ""}${canReorderNotes ? " is-reorderable" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}`}
        draggable={canReorderNotes}
        aria-grabbed={canReorderNotes && dragging ? true : undefined}
        onDragStart={event => handleNoteDragStart(event, note.id)}
        onDragEnd={handleNoteDragEnd}
        onDragEnter={() => {
          if (draggingNoteId && draggingNoteId !== note.id) setDropTargetNoteId(note.id);
        }}
        onDragOver={event => event.preventDefault()}
        onDrop={() => dropNote(note.id)}
      >
        <div className="note-card-top">
          <span className="note-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <span className="note-state-dot">{statuses.find(item => item.id === note.status)?.label ?? note.status}</span>
          <small>{formatKoDate(note.createdAt.slice(0, 10))}</small>
        </div>
        <div className="note-card-body">
          <h2>{note.title}</h2>
          {note.detail && <p>{note.detail}</p>}
          {note.extra && (isWebLink(note.extra)
            ? kind === "gift"
              ? <GiftLinkPreview url={note.extra} />
              : <a className="note-extra note-extra-link" href={note.extra} target="_blank" rel="noreferrer">링크 열기 <span>↗</span></a>
            : <p className="note-extra"><span>{copy.extra}</span>{note.extra}</p>)}
        </div>
        <div className="note-actions">
          <div className={`note-status-picker ${openStatusId === note.id ? "is-open" : ""}`} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpenStatusId(null);
          }}>
            <button className="note-status-trigger" type="button" aria-label={`${note.title} 상태 변경`} aria-haspopup="menu" aria-expanded={openStatusId === note.id} onClick={() => setOpenStatusId(current => current === note.id ? null : note.id)}>
              <i className={`status-tone status-tone-${statuses.findIndex(item => item.id === note.status)}`} />
              <span>{statuses.find(item => item.id === note.status)?.label ?? note.status}</span>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
            </button>
            {openStatusId === note.id && (
              <div className="note-status-menu" role="menu" aria-label="상태 선택">
                <header><span>상태 변경</span></header>
                {statuses.map((item, statusIndex) => (
                  <button type="button" role="menuitemradio" aria-checked={note.status === item.id} className={note.status === item.id ? "is-selected" : ""} onClick={() => changeStatus(note, item.id)} key={item.id}>
                    <i className={`status-tone status-tone-${statusIndex}`} />
                    <span><b>{item.label}</b></span>
                    <em>{note.status === item.id ? "✓" : ""}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
          {kind === "vault" && note.extra && !isWebLink(note.extra) && <button className="note-copy-button" type="button" onClick={() => void navigator.clipboard.writeText(note.extra)}>복사</button>}
          {kind === "gift" && <button className="note-detail-button" type="button" onClick={() => setSelectedNote(note)}>상세</button>}
          <button className="text-link" type="button" onClick={() => {
            const removedIndex = notes.findIndex(item => item.id === note.id);
            setNotes(current => current.filter(item => item.id !== note.id));
            void deleteNote(note.id).then(result => {
              if ("error" in result) {
                setNotes(current => [...current.slice(0, removedIndex), note, ...current.slice(removedIndex)]);
                setError(result.error);
              } else {
                router.refresh();
              }
            });
          }}>지우기</button>
        </div>
      </li>
    );
  }

  return (
    <div className={`notes-board notes-board-${kind}`}>
      <section className={`notes-hero ${kind === "bucket" ? "is-no-action" : ""}`}>
        <div className="notes-hero-copy">
          <div className="notes-kind-mark"><NoteKindIcon kind={kind} /></div>
          <div>
            <span className="eyebrow">{copy.eyebrow} · {meta.kicker}</span>
            <h1>{copy.title}</h1>
            <p>{copy.lead}</p>
          </div>
        </div>
        {kind !== "bucket" && (
          <button className="date-action-button is-primary" type="button" onClick={() => setOpen(true)} disabled={pending}>
            <HeaderActionIcon name="plus" /><span>{meta.addLabel}</span>
          </button>
        )}
        <div className="notes-overview" aria-label="목록 요약">
          <div><span>전체</span><strong>{notes.length}</strong><small>개의 기록</small></div>
          <div><span>{statuses.find(item => item.id === highlightStatus)?.label}</span><strong>{highlightCount}</strong><small>{highlightUnit}</small></div>
          <div className="notes-progress-card">
            <span>{kind === "vault" ? "보관 중 비율" : "진행률"}</span><strong>{progress}<small>%</small></strong>
            <i><b style={{ width: `${progress}%` }} /></i>
          </div>
        </div>
      </section>
      {!persist && <p className="inline-notice" role="status">로그인하면 둘이 같은 목록을 봐요. <a href="/login">로그인</a></p>}
      <div className="notes-toolbar">
        <div>
          <span className="eyebrow">{meta.collectionLabel}</span>
          <b>{visibleNotes.length}개</b>
        </div>
        <div className="notes-filter" role="group" aria-label="상태 필터">
          <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>전체</button>
          {statuses.map(item => <button type="button" className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
        </div>
        <label className="notes-search">
          <HeaderActionIcon name="search" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="목록에서 검색" aria-label="목록 검색" />
        </label>
      </div>
      {canReorderNotes && <p className="notes-reorder-hint" role="status">카드를 끌어 순서를 바꿀 수 있어요.</p>}
      {kind === "bucket" ? (
        <BucketWishBoard
          notes={notes}
          setNotes={setNotes}
          visibleNotes={visibleNotes}
          persist={persist}
          statuses={statuses}
          completedStatusId={completedStatus}
          collaborators={collaborators}
          progress={progress}
          doneCount={highlightCount}
          onError={setError}
          onRefresh={() => router.refresh()}
          onOpenDialog={() => setOpen(true)}
        />
      ) : !notes.length ? (
        <div className="notes-empty">
          <span><NoteKindIcon kind={kind} /></span>
          <h2>{meta.emptyTitle}</h2>
          <p>{meta.emptyDescription}</p>
          <button className="primary-button" type="button" onClick={() => setOpen(true)}>{meta.addLabel}</button>
        </div>
      ) : !visibleNotes.length ? (
        <div className="notes-no-result"><b>조건에 맞는 기록이 없어요.</b><button type="button" onClick={() => { setFilter("all"); setQuery(""); }}>필터 초기화</button></div>
      ) : kind === "gift" ? (
        <div className="gift-pipeline">
          {statuses.filter(item => filter === "all" || filter === item.id).map((item, columnIndex) => {
            const columnNotes = visibleNotes.filter(note => note.status === item.id);
            return (
              <section className={`gift-stage gift-stage-${item.id}`} key={item.id}>
                <header><span>{String(columnIndex + 1).padStart(2, "0")}</span><b>{item.label}</b><em>{columnNotes.length}</em></header>
                {columnNotes.length
                  ? <ul className="note-list">{columnNotes.map(note => renderNoteCard(note, notes.findIndex(item => item.id === note.id)))}</ul>
                  : <div className="gift-stage-empty"><i /><p>{item.id === "idea" ? "고민 중인 선물이 없어요" : item.id === "ready" ? "준비 중인 선물이 없어요" : "전달을 마친 선물이 없어요"}</p></div>}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className={`note-list${canReorderNotes ? " is-reorderable" : ""}`}>{visibleNotes.map((note, index) => renderNoteCard(note, notes.findIndex(item => item.id === note.id) ?? index))}</ul>
      )}
      {error && !open && <p className="notes-toast" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></p>}
      {open && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !pending && closeDialog()}>
          <form className={`place-create-dialog note-create-dialog note-create-dialog-${kind}`} role="dialog" aria-modal="true" aria-labelledby="note-dialog-title" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div className="note-dialog-title">
                <span className="notes-kind-mark"><NoteKindIcon kind={kind} /></span>
                <div><span className="eyebrow">NEW · {copy.eyebrow}</span><h2 id="note-dialog-title">{meta.dialogTitle}</h2></div>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => closeDialog()}>×</button>
            </div>
            <div className="note-dialog-content">
              <div className="note-dialog-fields">
                {kind === "vault" && (
                  <VaultScreenshotImport
                    persist={persist}
                    disabled={pending}
                    onBusy={setPending}
                    onError={setError}
                    onPreviewChange={onVaultPreviewChange}
                    onSaved={saved => {
                      setNotes(current => [...saved, ...current]);
                      emitCoupleActivitiesChanged();
                      closeDialog();
                      router.refresh();
                    }}
                  />
                )}
                {kind === "vault" && !vaultScanPreview && <p className="vault-scan-divider" aria-hidden="true"><span>또는 직접 입력</span></p>}
                {!vaultScanPreview && (
                  <>
                <label className="field">
                  <span>{meta.titleLabel}</span>
                  <input value={title} onChange={event => setTitle(event.target.value)} placeholder={copy.placeholder} required />
                </label>
                {kind === "gift" && (
                  <label className="field gift-url-field">
                    <span>{copy.extra}</span>
                    <div><span aria-hidden="true">↗</span><input type="url" value={extra} onChange={event => setExtra(event.target.value)} placeholder={copy.extraPh} /></div>
                    <small>구매를 고민 중인 상품 주소를 붙여 넣어 주세요.</small>
                  </label>
                )}
                <label className="field">
                  <span>{meta.detailLabel}</span>
                  <textarea value={detail} onChange={event => setDetail(event.target.value)} rows={kind === "gift" ? 5 : 4} />
                </label>
                {kind !== "gift" && (
                  <label className="field">
                    <span>{copy.extra}</span>
                    <input value={extra} onChange={event => setExtra(event.target.value)} placeholder={copy.extraPh} />
                  </label>
                )}
                <label className="field">
                  <span>진행 상태</span>
                  <select className="note-status-select" value={status} onChange={event => setStatus(event.target.value)}>
                    {statuses.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <div className="dialog-actions">
                  <button className="outline-button" type="button" onClick={() => closeDialog()} disabled={pending}>취소</button>
                  <button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : kind === "gift" ? "선물 플랜 저장" : "저장"}</button>
                </div>
                  </>
                )}
                {error && <p className="form-error" role="alert">{error}</p>}
              </div>
              {kind === "gift" && (
                <aside className={`gift-web-preview ${isWebLink(extra) ? "has-link" : ""}`} aria-live="polite">
                  <div className="gift-browser-bar"><i /><i /><i /><span>{isWebLink(extra) ? linkHost(extra) : "상품 링크 미리보기"}</span></div>
                  <GiftLinkPreview url={extra} mode="editor" />
                </aside>
              )}
            </div>
          </form>
        </div>
      )}
      {selectedNote && kind === "gift" && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setSelectedNote(null)}>
          <article className="gift-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="gift-detail-title" onClick={event => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow">GIFT DETAIL</span><h2 id="gift-detail-title">{selectedNote.title}</h2></div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => setSelectedNote(null)}>×</button>
            </header>
            {isWebLink(selectedNote.extra) && <GiftLinkPreview url={selectedNote.extra} mode="detail" />}
            <div className="gift-detail-facts">
              <div><span>진행 상태</span><b>{statuses.find(item => item.id === selectedNote.status)?.label}</b></div>
              <div><span>기록한 날</span><b>{formatKoDate(selectedNote.createdAt.slice(0, 10))}</b></div>
            </div>
            <section><span>IDEA & NOTE</span><p>{selectedNote.detail || "아직 남긴 메모가 없어요."}</p></section>
            <footer><button className="outline-button" type="button" onClick={() => setSelectedNote(null)}>닫기</button>{isWebLink(selectedNote.extra) && <a className="primary-button" href={selectedNote.extra} target="_blank" rel="noreferrer">상품 페이지 열기 ↗</a>}</footer>
          </article>
        </div>
      )}
    </div>
  );
}
