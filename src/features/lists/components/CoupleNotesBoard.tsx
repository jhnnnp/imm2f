"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { formatKoDate } from "@/lib/dates";
import { createNote, deleteNote, listNotes, reorderNotes, updateNoteStatus } from "../actions";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { SyncNotice } from "@/components/shared/SyncNotice";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { VaultScreenshotImport } from "./VaultScreenshotImport";
import { BucketWishBoard } from "./BucketWishBoard";
import { NOTE_COPY, NOTE_STATUS, type CoupleNote, type NoteKind } from "../types";
import { noteCreationAttempt, type NoteCreationAttempt } from "../noteCreationAttempt";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import { FOLDER_DRAG_MIME, type FolderWorkspace } from "@/features/folders/types";
import { useFolderWorkspace } from "@/features/folders/useFolderWorkspace";
import { FolderShelf } from "@/features/folders/components/FolderShelf";
import { FolderMoveMenu } from "@/features/folders/components/FolderMoveMenu";
import styles from "./VaultFolderBoard.module.css";

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
    kicker: "우리의 중요한 정보를 안전하게 한곳에",
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
    emptyDescription: "가고 싶은 곳부터 사소한 도전까지, 우리의 다음 장면을 시작해요.",
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
    setMetadata(null);
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() as Promise<LinkMetadata> : Promise.reject())
        .then(value => { if (!controller.signal.aborted) setMetadata(value); })
        .catch(() => { if (!controller.signal.aborted) setMetadata(null); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
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
        <div className="gift-rich-visual">{metadata?.image ? <img src={metadata.image} alt="" loading="lazy" decoding="async" /> : <span>{linkHost(url).slice(0, 1).toUpperCase()}</span>}</div>
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
  initialFolderWorkspace,
}: {
  kind: NoteKind;
  initialNotes: CoupleNote[];
  persist: boolean;
  collaborators?: { viewerId: string; viewerName: string; partnerName: string };
  initialFolderWorkspace?: FolderWorkspace;
}) {
  const copy = NOTE_COPY[kind];
  const router = useRouter();
  const meta = KIND_META[kind];
  const statuses = NOTE_STATUS[kind];
  const [notes, setNotes] = useState(initialNotes);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
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
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const draggedNoteRef = useRef<string | null>(null);
  const creationAttemptRef = useRef<NoteCreationAttempt | null>(null);
  const folders = useFolderWorkspace(kind === "vault" ? "vault" : null, initialFolderWorkspace);

  const pendingRef = useRef(false);
  const createDialogRef = useDialogFocus<HTMLFormElement>({ open, onClose: closeDialog });
  const detailDialogRef = useDialogFocus<HTMLElement>({ open: kind === "gift" && selectedNote !== null, onClose: closeDetails });
  const onBusy = useCallback((busy: boolean) => {
    pendingRef.current = busy;
    setPending(busy);
  }, []);
  const beginMutation = useCallback(() => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    return true;
  }, []);
  const endMutation = useCallback(() => onBusy(false), [onBusy]);
  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    try {
      const remote = await listNotes(kind);
      if (!isCurrent() || pendingRef.current) return;
      setNotes(remote.notes);
      setSyncError("");
    } catch {
      if (isCurrent()) setSyncError("최신 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    }
  }, { tables: ["couple_notes"], activityPrefixes: [kind === "vault" ? "VAULT_" : kind === "gift" ? "GIFT_" : "BUCKET_"] });

  useEffect(() => {
    if (!pendingRef.current) setNotes(initialNotes);
  }, [initialNotes]);
  useEffect(() => {
    setSelectedNote(current => current ? notes.find(note => note.id === current.id) ?? null : null);
  }, [notes]);

  function refreshAfterMutation() {
    emitCoupleActivitiesChanged();
    router.refresh();
    retrySync();
  }

  const onVaultPreviewChange = useCallback((preview: boolean) => {
    setVaultScanPreview(preview);
  }, []);

  function closeDialog() {
    if (pendingRef.current) return;
    setOpen(false);
    setVaultScanPreview(false);
    setError("");
  }

  function closeDetails() {
    if (!pendingRef.current) setSelectedNote(null);
  }

  const visibleNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return notes.filter(note => {
      if (kind === "vault" && !folders.matchesFolder(note.id)) return false;
      if (filter !== "all" && note.status !== filter) return false;
      if (!normalized) return true;
      return [note.title, note.detail, note.extra].some(value => value.toLocaleLowerCase("ko-KR").includes(normalized));
    });
  }, [filter, notes, query, kind, folders.matchesFolder]);

  const selectedIds = useMemo(() => {
    const selected = new Set(selectedNoteIds);
    return visibleNotes.filter(note => selected.has(note.id)).map(note => note.id);
  }, [visibleNotes, selectedNoteIds]);
  const selectedIdSet = new Set(selectedIds);
  const foldersById = useMemo(() => new Map(folders.workspace.folders.map(folder => [folder.id, folder])), [folders.workspace.folders]);
  const currentFolder = foldersById.get(folders.selectedFolderId);
  const folderNotes = kind === "vault" ? notes.filter(note => folders.matchesFolder(note.id)) : notes;
  const canOrganizeNotes = kind === "vault" && persist && folders.workspace.persist && !pending && !folders.pending;

  const completedStatus = statuses.at(-1)?.id;
  const highlightStatus = kind === "vault" ? statuses[0].id : completedStatus;
  const highlightCount = notes.filter(note => note.status === highlightStatus).length;
  const progress = notes.length ? Math.round((highlightCount / notes.length) * 100) : 0;
  const canReorderNotes = persist && !pending && !folders.pending && kind === "vault" && folders.selectedFolderId === "all" && filter === "all" && !query.trim() && notes.length > 1 && selectedIds.length < 2;

  function openNoteFolder(id: string) {
    folders.setSelectedFolderId(id);
    setSelectedNoteIds([]);
    setFilter("all");
    setQuery("");
  }

  function dropNote(targetId: string) {
    const draggedId = draggedNoteRef.current;
    draggedNoteRef.current = null;
    setDraggingNoteId(null);
    setDropTargetNoteId(null);
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
    void reorderNotes(kind, reordered.map(note => note.id))
      .catch(() => ({ error: "순서를 저장하지 못했어요. 연결을 확인해 주세요." }))
      .then(result => {
        endMutation();
        if ("error" in result) { setNotes(snapshot); setError(result.error); }
        refreshAfterMutation();
      });
  }

  function isNoteDragBlocked(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return true;
    return Boolean(target.closest("button, a, input, select, textarea, label, [role=menu], .note-status-menu"));
  }

  function handleNoteDragStart(event: DragEvent, noteId: string) {
    if ((!canReorderNotes && !canOrganizeNotes) || isNoteDragBlocked(event.target)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", noteId);
    event.dataTransfer.setData(FOLDER_DRAG_MIME, JSON.stringify({
      scope: "vault",
      ids: selectedIdSet.has(noteId) ? selectedIds : [noteId],
    }));
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
    if (!beginMutation()) return;
    setError("");
    const input = { title, detail, extra, status };
    creationAttemptRef.current = noteCreationAttempt(creationAttemptRef.current, kind, input);
    const result = await createNote(kind, { ...input, attemptId: creationAttemptRef.current.id })
      .catch(() => ({ error: "저장 응답을 확인하지 못했어요. 목록을 확인한 뒤 다시 시도해 주세요." }));
    if ("error" in result) {
      endMutation();
      setError(result.error);
      retrySync();
      return;
    }
    creationAttemptRef.current = null;
    setNotes(current => [result.note, ...current.filter(note => note.id !== result.note.id)]);
    const filed = kind === "vault" && currentFolder
      ? await folders.moveItems([result.note.id], currentFolder.id).catch(() => false)
      : true;
    endMutation();
    emitCoupleActivitiesChanged();
    closeDialog();
    if (!filed) setError("기록은 저장됐지만 폴더에 넣지 못했어요. 미분류 기록에서 다시 옮겨 주세요.");
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
    if (!persist || !beginMutation()) return;
    const previous = note.status;
    setOpenStatusId(null);
    setNotes(current => current.map(item => item.id === note.id ? { ...item, status: next } : item));
    void updateNoteStatus(note.id, next, note.updatedAt)
      .catch(() => ({ error: "상태를 저장하지 못했어요. 연결을 확인해 주세요." }))
      .then(result => {
        endMutation();
        if ("error" in result) {
          setNotes(current => current.map(item => item.id === note.id ? { ...item, status: previous } : item));
          setError(result.error);
        } else {
          setNotes(current => current.map(item => item.id === note.id ? result.note : item));
        }
        refreshAfterMutation();
      });
  }

  function renderNoteCard(note: CoupleNote, index: number) {
    const dragging = draggingNoteId === note.id;
    const dropTarget = dropTargetNoteId === note.id && draggingNoteId !== note.id;
    return (
      <li
        key={note.id}
        className={`${note.status === completedStatus ? "is-complete" : ""}${canReorderNotes ? " is-reorderable" : ""}${dragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}${kind === "vault" ? ` ${styles.record}${selectedIdSet.has(note.id) ? ` ${styles.selectedRecord}` : ""}` : ""}`}
        draggable={canReorderNotes || canOrganizeNotes}
        aria-grabbed={(canReorderNotes || canOrganizeNotes) && dragging ? true : undefined}
        onDragStart={event => handleNoteDragStart(event, note.id)}
        onDragEnd={handleNoteDragEnd}
        onDragEnter={() => {
          if (canReorderNotes && draggingNoteId && draggingNoteId !== note.id) setDropTargetNoteId(note.id);
        }}
        onDragOver={event => { if (canReorderNotes) event.preventDefault(); }}
        onDrop={() => { if (canReorderNotes) dropNote(note.id); }}
      >
        <div className="note-card-top">
          {kind === "vault" && <label className={styles.recordCheck}>
            <input type="checkbox" checked={selectedIdSet.has(note.id)} disabled={!canOrganizeNotes} aria-label={`${note.title} 선택`} onChange={event => {
              setSelectedNoteIds(current => event.target.checked ? [...new Set([...current, note.id])] : current.filter(id => id !== note.id));
            }} />
          </label>}
          <span className="note-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <span className="note-state-dot">{statuses.find(item => item.id === note.status)?.label ?? note.status}</span>
          <small>{formatKoDate(note.createdAt.slice(0, 10))}</small>
        </div>
        <div className="note-card-body">
          {kind === "vault" && <span className={styles.folderTag}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h4l2 2H16A1.5 1.5 0 0 1 17.5 8v7A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15V6Z" /></svg>
            {foldersById.get(folders.folderFor(note.id) ?? "")?.name ?? "아직 정리하지 않은 기록"}
          </span>}
          <h2>{note.title}</h2>
          {collaborators && note.createdBy && <small className="memo-author">{note.createdBy === collaborators.viewerId ? collaborators.viewerName : collaborators.partnerName} · 작성</small>}
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
            <button className="note-status-trigger" type="button" disabled={pending} aria-label={`${note.title} 상태 변경`} aria-haspopup="menu" aria-expanded={openStatusId === note.id} onClick={() => setOpenStatusId(current => current === note.id ? null : note.id)}>
              <i className={`status-tone status-tone-${statuses.findIndex(item => item.id === note.status)}`} />
              <span>{statuses.find(item => item.id === note.status)?.label ?? note.status}</span>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
            </button>
            {openStatusId === note.id && (
              <div className="note-status-menu" role="menu" aria-label="상태 선택">
                <header><span>상태 변경</span></header>
                {statuses.map((item, statusIndex) => (
                  <button type="button" disabled={pending} role="menuitemradio" aria-checked={note.status === item.id} className={note.status === item.id ? "is-selected" : ""} onClick={() => changeStatus(note, item.id)} key={item.id}>
                    <i className={`status-tone status-tone-${statusIndex}`} />
                    <span><b>{item.label}</b></span>
                    <em>{note.status === item.id ? "✓" : ""}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
          {kind === "vault" && <FolderMoveMenu
            folders={folders.workspace.folders}
            value={folders.folderFor(note.id)}
            disabled={!canOrganizeNotes}
            onMove={id => folders.moveItems([note.id], id)}
          />}
          {kind === "vault" && note.extra && !isWebLink(note.extra) && <button className="note-copy-button" type="button" onClick={() => void navigator.clipboard.writeText(note.extra).catch(() => setError("복사하지 못했어요. 번호를 직접 선택해 주세요."))}>복사</button>}
          {kind === "gift" && <button className="note-detail-button" type="button" disabled={pending} onClick={() => setSelectedNote(note)}>상세</button>}
          <button className="text-link" type="button" disabled={pending} onClick={() => {
            if (!persist || !beginMutation()) return;
            const snapshot = notes;
            setNotes(current => current.filter(item => item.id !== note.id));
            void deleteNote(note.id)
              .catch(() => ({ error: "삭제 응답을 확인하지 못했어요. 최신 목록을 확인해 주세요." }))
              .then(result => {
                endMutation();
                if ("error" in result) { setNotes(snapshot); setError(result.error); }
                refreshAfterMutation();
              });
          }}>지우기</button>
        </div>
      </li>
    );
  }

  return (
    <div className={`notes-board notes-board-${kind}`}>
      <SyncNotice message={syncError} onRetry={retrySync} />
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
          <div><span>전체 기록</span><strong>{notes.length}</strong><small>개</small></div>
          <div><span>{statuses.find(item => item.id === highlightStatus)?.label}</span><strong>{highlightCount}</strong><small>개</small></div>
          {kind === "vault" ? (
            <div><span>사용 완료</span><strong>{notes.filter(note => note.status === "used").length}</strong><small>개 · 보관 종료 {notes.filter(note => note.status === "archived").length}개</small></div>
          ) : (
            <div className="notes-progress-card">
              <span>{kind === "gift" ? "전달률" : "달성률"}</span><strong>{progress}<small>%</small></strong>
              <i><b style={{ width: `${progress}%` }} /></i>
            </div>
          )}
        </div>
      </section>
      {!persist && <p className="inline-notice" role="status">로그인하면 둘이 같은 목록을 봐요. <a href="/login">로그인</a></p>}
      {kind === "vault" && <FolderShelf scope="vault" controller={{ ...folders, setSelectedFolderId: openNoteFolder }} items={notes.map(note => ({ id: note.id, title: note.title }))} label="기록" />}
      <div className="notes-toolbar">
        <div>
          <span className="eyebrow">{kind === "vault" ? currentFolder?.name ?? (folders.selectedFolderId === "unfiled" ? "미분류 기록" : "전체 기록") : meta.collectionLabel}</span>
          <b>{visibleNotes.length}개</b>
        </div>
        <div className="notes-filter" role="group" aria-label="상태 필터">
          <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>전체</button>
          {statuses.map(item => <button type="button" className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
        </div>
        <label className="notes-search">
          <HeaderActionIcon name="search" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={currentFolder ? "이 폴더에서 검색" : "목록에서 검색"} aria-label="목록 검색" />
        </label>
      </div>
      {kind === "vault" && visibleNotes.length > 0 && <div className={styles.selectionBar}>
        <label><input type="checkbox" aria-label="현재 목록 모두 선택" ref={node => { if (node) node.indeterminate = selectedIds.length > 0 && selectedIds.length < visibleNotes.length; }} disabled={!canOrganizeNotes} checked={selectedIds.length === visibleNotes.length} onChange={event => setSelectedNoteIds(event.target.checked ? visibleNotes.map(note => note.id) : [])} /><span>{selectedIds.length ? `${selectedIds.length}개 선택` : "기록 선택"}</span></label>
        {selectedIds.length > 0 ? <><FolderMoveMenu folders={folders.workspace.folders} value={null} disabled={!canOrganizeNotes} onMove={async id => {
          const moved = await folders.moveItems(selectedIds, id).catch(() => false);
          if (moved) setSelectedNoteIds([]);
          return moved;
        }} /><button type="button" onClick={() => setSelectedNoteIds([])}>선택 해제</button></> : <span className={styles.dragHint}>{canOrganizeNotes ? "기록을 폴더에 끌어 넣거나, 선택해서 함께 정리해 보세요." : "둘의 기록을 폴더별로 차곡차곡 모아 두세요."}</span>}
      </div>}
      {canReorderNotes && <p className="notes-reorder-hint" role="status">전체 보기에서는 기록을 끌어 순서도 바꿀 수 있어요.</p>}
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
          onRefresh={refreshAfterMutation}
          beginMutation={beginMutation}
          endMutation={endMutation}
          busy={pending}
          onOpenDialog={() => setOpen(true)}
        />
      ) : !notes.length && !(kind === "vault" && currentFolder) ? (
        <div className="notes-empty">
          <span><NoteKindIcon kind={kind} /></span>
          <h2>{meta.emptyTitle}</h2>
          <p>{meta.emptyDescription}</p>
          <button className="primary-button" type="button" onClick={() => setOpen(true)}>{meta.addLabel}</button>
        </div>
      ) : !visibleNotes.length ? (
        kind === "vault" && !folderNotes.length ? <div className={`notes-empty ${styles.folderEmpty}`}>
          <span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M9 14h6M12 11v6" /></svg></span>
          <h2>{currentFolder ? `‘${currentFolder.name}’에 첫 기록을 담아볼까요?` : "정리가 끝났어요"}</h2>
          <p>{currentFolder ? "예약 정보, 편지, 작은 메모를 이 폴더에 차곡차곡 보관해요." : "폴더에 넣지 않은 기록이 없어요. 새 기록을 보관하거나 전체 기록을 둘러보세요."}</p>
          <button className="primary-button" type="button" onClick={() => setOpen(true)}>{meta.addLabel}</button>
          <button className="text-link" type="button" onClick={() => openNoteFolder("all")}>전체 기록 보기</button>
        </div> : <div className="notes-no-result"><b>조건에 맞는 기록이 없어요.</b><button type="button" onClick={() => { setFilter("all"); setQuery(""); }}>필터 초기화</button></div>
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
        <div className="dialog-backdrop" role="presentation" onClick={closeDialog}>
          <form ref={createDialogRef} tabIndex={-1} className={`place-create-dialog note-create-dialog note-create-dialog-${kind}`} role="dialog" aria-modal="true" aria-labelledby="note-dialog-title" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div className="note-dialog-title">
                <span className="notes-kind-mark"><NoteKindIcon kind={kind} /></span>
                <div><span className="eyebrow">NEW · {copy.eyebrow}</span><h2 id="note-dialog-title">{meta.dialogTitle}</h2></div>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" disabled={pending} onClick={() => closeDialog()}>×</button>
            </div>
            <div className="note-dialog-content">
              <div className="note-dialog-fields">
                {kind === "vault" && <div className={styles.saveDestination}><span>보관할 위치</span><b>{currentFolder?.name ?? "미분류 기록"}</b><small>{currentFolder ? "새 기록은 이 폴더에 함께 담겨요." : "저장한 뒤 원하는 폴더로 옮길 수 있어요."}</small></div>}
                {kind === "vault" && (
                  <VaultScreenshotImport
                    persist={persist}
                    disabled={pending}
                    beginMutation={beginMutation}
                    endMutation={endMutation}
                    onError={setError}
                    onPreviewChange={onVaultPreviewChange}
                    onSaved={saved => {
                      const ids = new Set(saved.map(note => note.id));
                      setNotes(current => [...saved, ...current.filter(note => !ids.has(note.id))]);
                      emitCoupleActivitiesChanged();
                      closeDialog();
                      if (currentFolder) void folders.moveItems(saved.map(note => note.id), currentFolder.id)
                        .catch(() => false)
                        .then(filed => { if (!filed) setError("기록은 저장됐지만 폴더에 넣지 못했어요. 미분류 기록에서 다시 옮겨 주세요."); });
                      router.refresh();
                    }}
                  />
                )}
                {kind === "vault" && !vaultScanPreview && <p className="vault-scan-divider" aria-hidden="true"><span>또는 직접 입력</span></p>}
                {!vaultScanPreview && (
                  <>
                <label className="field">
                  <span>{meta.titleLabel}</span>
                  <input data-dialog-autofocus value={title} onChange={event => setTitle(event.target.value)} placeholder={copy.placeholder} required disabled={pending} />
                </label>
                {kind === "gift" && (
                  <label className="field gift-url-field">
                    <span>{copy.extra}</span>
                    <div><span aria-hidden="true">↗</span><input type="url" value={extra} onChange={event => setExtra(event.target.value)} placeholder={copy.extraPh} disabled={pending} /></div>
                    <small>구매를 고민 중인 상품 주소를 붙여 넣어 주세요.</small>
                  </label>
                )}
                <label className="field">
                  <span>{meta.detailLabel}</span>
                  <textarea value={detail} onChange={event => setDetail(event.target.value)} rows={kind === "gift" ? 5 : 4} disabled={pending} />
                </label>
                {kind !== "gift" && (
                  <label className="field">
                    <span>{copy.extra}</span>
                    <input value={extra} onChange={event => setExtra(event.target.value)} placeholder={copy.extraPh} disabled={pending} />
                  </label>
                )}
                <label className="field">
                  <span>진행 상태</span>
                  <select className="note-status-select" value={status} onChange={event => setStatus(event.target.value)} disabled={pending}>
                    {statuses.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <div className="dialog-actions">
                  <button className="outline-button" type="button" onClick={() => closeDialog()} disabled={pending}>취소</button>
                  <button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "저장 중..." : kind === "gift" ? "선물 플랜 저장" : "저장"}</button>
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
        <div className="dialog-backdrop" role="presentation" onClick={closeDetails}>
          <article ref={detailDialogRef} tabIndex={-1} className="gift-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="gift-detail-title" onClick={event => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow">GIFT DETAIL</span><h2 id="gift-detail-title" data-dialog-autofocus tabIndex={-1}>{selectedNote.title}</h2></div>
              <button className="icon-button" type="button" aria-label="닫기" disabled={pending} onClick={closeDetails}>×</button>
            </header>
            {isWebLink(selectedNote.extra) && <GiftLinkPreview url={selectedNote.extra} mode="detail" />}
            <div className="gift-detail-facts">
              <div><span>진행 상태</span><b>{statuses.find(item => item.id === selectedNote.status)?.label}</b></div>
              <div><span>기록한 날</span><b>{formatKoDate(selectedNote.createdAt.slice(0, 10))}</b></div>
            </div>
            <section><span>IDEA & NOTE</span><p>{selectedNote.detail || "아직 남긴 메모가 없어요."}</p></section>
            <footer><button className="outline-button" type="button" disabled={pending} onClick={closeDetails}>닫기</button>{isWebLink(selectedNote.extra) && <a className="primary-button" href={selectedNote.extra} target="_blank" rel="noreferrer">상품 페이지 열기 ↗</a>}</footer>
          </article>
        </div>
      )}
    </div>
  );
}
