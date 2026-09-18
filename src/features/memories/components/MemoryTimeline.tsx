"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createMemory, deleteMemory, updateMemory } from "../actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import type { Memory, MemoryType, PhotoMetadataInput } from "../types";
import type { Place } from "@/features/places/types/place";
import { formatKoDate, toIsoDate } from "@/lib/dates";
import { CorkPiece } from "./CorkPiece";
import { MemoryCanvas } from "./MemoryCanvas";
import {
  defaultCorkPose,
  scatterCorkPoses,
  type CorkPose,
} from "../corkLayout";
import { inspectMemoryPhoto } from "../photoInspect";
import { useResolvedMemories } from "../resolvePhotoUrls";
import {
  albumTiles,
  buildWallPieces,
  MAX_MEMORY_PHOTO_BYTES,
  MAX_MEMORY_PHOTOS,
  MEMORY_PHOTO_ACCEPT,
  memoryImages,
} from "../wallPieces";

type MemoryTab = "timeline" | "album" | "map" | "trip" | "date";
type CreateStep = "photo" | "story";
type PhotoDraft = {
  key: string;
  file: File;
  preview: string;
  meta: PhotoMetadataInput | null;
  pending: boolean;
};

const MEMORY_TYPE_LABEL: Record<MemoryType, string> = { free: "그날", trip: "여행", date: "데이트" };
const MEMORY_TABS: ReadonlyArray<{ id: MemoryTab; label: string }> = [
  { id: "timeline", label: "벽면" },
  { id: "album", label: "앨범" },
  { id: "map", label: "지도" },
  { id: "trip", label: "여행" },
  { id: "date", label: "데이트" },
];

type Fastener = "pin" | "pin-left" | "tape-left" | "tape-right";

function fastenerFor(photo: boolean, index: number): Fastener {
  if (photo) return index % 2 === 0 ? "tape-left" : "tape-right";
  return index % 3 === 1 ? "pin-left" : "pin";
}

function WallFastener({ kind }: { kind: Fastener }) {
  if (kind.startsWith("tape")) return <span className={`memory-tape is-${kind}`} aria-hidden="true" />;
  return <span className={`letter-pin is-${kind}`} aria-hidden="true" />;
}

function MemoryTypeMark({ type, className }: { type: MemoryType; className: string }) {
  if (type === "free") return null;
  return <span className={`${className} is-${type}`}>{MEMORY_TYPE_LABEL[type]}</span>;
}

function MemoryFace({ memory, size = "card", imageClassName }: { memory: Memory; size?: "hero" | "card" | "mini"; imageClassName?: string }) {
  const image = memoryImages(memory)[0];
  if (image) return <img className={imageClassName} src={image.url} alt="" />;
  return (
    <div className={`memory-letter-face is-${memory.memoryType} is-${size}`}>
      <i className="memory-letter-margin" aria-hidden="true" />
      {memory.memoryType !== "free" && <em>{MEMORY_TYPE_LABEL[memory.memoryType]}</em>}
      <b>{memory.title}</b>
      <small>{formatKoDate(memory.happenedOn)}</small>
    </div>
  );
}

function revokeDrafts(items: PhotoDraft[]) {
  items.forEach(item => {
    if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  });
}

export function MemoryTimeline({
  initialMemories,
  places,
  persist,
}: {
  initialMemories: Memory[];
  places: Place[];
  persist: boolean;
}) {
  const session = useAppSession();
  const [memories, setMemories] = useState(initialMemories);
  const displayMemories = useResolvedMemories(memories);
  const [tab, setTab] = useState<MemoryTab>("timeline");
  const [open, setOpen] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("photo");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [happenedOn, setHappenedOn] = useState("");
  const [description, setDescription] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [drafts, setDrafts] = useState<PhotoDraft[]>([]);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [viewer, setViewer] = useState<Memory | null>(null);
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");
  const [editType, setEditType] = useState<MemoryType>("free");
  const [editDrafts, setEditDrafts] = useState<PhotoDraft[]>([]);
  const [coverFailed, setCoverFailed] = useState(false);
  const [memoryType, setMemoryType] = useState<MemoryType>("free");
  const coupleKey = session.mode === "authenticated" ? session.coupleId : "guest";
  const [corkPoses, setCorkPoses] = useState<Record<string, CorkPose>>({});
  const [corkDraggingId, setCorkDraggingId] = useState<string | null>(null);
  const [wallToolbar, setWallToolbar] = useState<HTMLDivElement | null>(null);
  const draftsRef = useRef(drafts);
  const editDraftsRef = useRef(editDrafts);
  draftsRef.current = drafts;
  editDraftsRef.current = editDrafts;

  useEffect(() => {
    setHappenedOn(current => current || toIsoDate(new Date()));
  }, []);

  useEffect(() => {
    setCoverFailed(false);
  }, [viewer?.id, viewerPhotoIndex]);

  useEffect(() => () => {
    revokeDrafts(draftsRef.current);
    revokeDrafts(editDraftsRef.current);
  }, []);

  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [places],
  );
  const visible = useMemo(() => {
    if (tab === "trip") return displayMemories.filter(item => item.memoryType === "trip");
    if (tab === "date") return displayMemories.filter(item => item.memoryType === "date");
    return displayMemories;
  }, [displayMemories, tab]);
  const wallPieces = useMemo(() => buildWallPieces(visible), [visible]);
  const tiles = useMemo(() => albumTiles(visible), [visible]);
  const mappedMemories = useMemo(() => visible.filter(item => item.coordinates), [visible]);
  const viewerImages = viewer ? memoryImages(viewer) : [];
  const activeViewerImage = viewerImages[viewerPhotoIndex] ?? viewerImages[0] ?? null;

  useEffect(() => {
    if (!viewer || editing) return;
    const count = viewerImages.length;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
      }
      if (count < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCoverFailed(false);
        setViewerPhotoIndex(index => (index + 1) % count);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCoverFailed(false);
        setViewerPhotoIndex(index => (index - 1 + count) % count);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer, editing, viewerImages.length]);

  const corkPieceProps = {
    poses: corkPoses,
    setPoses: setCorkPoses,
    coupleId: coupleKey,
    draggingId: corkDraggingId,
    setDraggingId: setCorkDraggingId,
    total: wallPieces.length,
  };

  function applyPhotoFacts(meta: PhotoMetadataInput | null, overwrite: boolean) {
    if (!meta) return;
    if (Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)) {
      setLatitude(Number(meta.latitude).toFixed(6));
      setLongitude(Number(meta.longitude).toFixed(6));
      setLocationLabel(current => current || "사진의 촬영 위치");
    }
    if (overwrite && meta.capturedAt) {
      const captured = new Date(meta.capturedAt);
      if (!Number.isNaN(captured.getTime())) setHappenedOn(toIsoDate(captured));
    }
  }

  async function addDrafts(files: FileList | File[] | null, target: "create" | "edit") {
    if (!files?.length) return;
    const current = target === "create" ? drafts : editDrafts;
    const room = MAX_MEMORY_PHOTOS - current.length - (target === "edit" && viewer ? memoryImages(viewer).length : 0);
    const incoming = [...files].slice(0, Math.max(0, room));
    if (!incoming.length) {
      setError(`사진은 최대 ${MAX_MEMORY_PHOTOS}장까지 붙일 수 있어요.`);
      return;
    }
    const next: PhotoDraft[] = incoming.map(file => ({
      key: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      meta: null,
      pending: true,
    }));
    const emptyBefore = current.length === 0;
    if (target === "create") setDrafts(items => [...items, ...next]);
    else setEditDrafts(items => [...items, ...next]);
    await Promise.all(next.map(async (draft, index) => {
      const meta = await inspectMemoryPhoto(draft.file);
      if (target === "create") {
        setDrafts(items => items.map(item => item.key === draft.key ? { ...item, meta, pending: false } : item));
        if (emptyBefore && index === 0) applyPhotoFacts(meta, true);
      } else {
        setEditDrafts(items => items.map(item => item.key === draft.key ? { ...item, meta, pending: false } : item));
      }
    }));
  }

  function removeDraft(key: string, target: "create" | "edit") {
    const list = target === "create" ? drafts : editDrafts;
    const found = list.find(item => item.key === key);
    if (found?.preview.startsWith("blob:")) URL.revokeObjectURL(found.preview);
    if (target === "create") setDrafts(items => items.filter(item => item.key !== key));
    else setEditDrafts(items => items.filter(item => item.key !== key));
  }

  function openComposer() {
    setCreateStep("photo");
    setError("");
    setOpen(true);
  }

  function closeComposer() {
    if (pending) return;
    revokeDrafts(drafts);
    setDrafts([]);
    setOpen(false);
  }

  function continueToStory() {
    setTitle(current => current || (locationLabel && locationLabel !== "사진의 촬영 위치" ? `${locationLabel}에서의 우리` : "우리의 하루"));
    setCreateStep("story");
  }

  function openViewer(memory: Memory, photoIndex = 0) {
    setViewer(memory);
    setViewerPhotoIndex(photoIndex);
    setEditing(false);
    setError("");
  }

  function beginEdit(memory: Memory) {
    setEditTitle(memory.title);
    setEditDate(memory.happenedOn);
    setEditDescription(memory.description);
    setEditLocation(memory.locationLabel);
    setEditLongitude(memory.coordinates?.[0]?.toString() ?? "");
    setEditLatitude(memory.coordinates?.[1]?.toString() ?? "");
    setEditType(memory.memoryType);
    revokeDrafts(editDrafts);
    setEditDrafts([]);
    setError("");
    setEditing(true);
  }

  function closeViewer() {
    revokeDrafts(editDrafts);
    setEditDrafts([]);
    setEditing(false);
    setViewer(null);
  }

  function cancelEdit() {
    revokeDrafts(editDrafts);
    setEditDrafts([]);
    setEditing(false);
    setError("");
  }

  async function uploadDrafts(items: PhotoDraft[]): Promise<{ photos: PhotoMetadataInput[]; paths: string[] } | { error: string }> {
    if (!items.length) return { photos: [], paths: [] };
    if (session.mode !== "authenticated") return { error: "로그인 후 사진을 올릴 수 있어요." };
    const oversized = items.find(item => item.file.size > MAX_MEMORY_PHOTO_BYTES);
    if (oversized) return { error: "20MB 이하 이미지만 올릴 수 있어요." };
    const supabase = createClient();
    if (!supabase) return { error: "저장소를 아직 연결하지 않았어요." };
    const photos: PhotoMetadataInput[] = [];
    const paths: string[] = [];
    for (const draft of items) {
      const ext = (draft.file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${session.coupleId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await supabase.storage.from("memory-photos").upload(path, draft.file, { contentType: draft.file.type, upsert: false });
      if (uploaded.error) {
        if (paths.length) await supabase.storage.from("memory-photos").remove(paths);
        return { error: uploaded.error.message || "사진을 올리지 못했어요." };
      }
      paths.push(path);
      photos.push({ ...draft.meta, storagePath: path });
    }
    return { photos, paths };
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!viewer) return;
    if (session.mode !== "authenticated") {
      setError("로그인 후 추억을 수정할 수 있어요.");
      return;
    }
    setPending(true);
    setError("");
    const lat = editLatitude.trim() ? Number(editLatitude) : null;
    const lng = editLongitude.trim() ? Number(editLongitude) : null;
    const uploaded = await uploadDrafts(editDrafts);
    if ("error" in uploaded) {
      setPending(false);
      setError(uploaded.error);
      return;
    }
    const result = await updateMemory({
      id: viewer.id,
      title: editTitle,
      happenedOn: editDate,
      description: editDescription,
      locationLabel: editLocation,
      memoryType: editType,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      photos: uploaded.photos,
    });
    if ("error" in result) {
      if (uploaded.paths.length) {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove(uploaded.paths);
      }
      setPending(false);
      setError(result.error);
      return;
    }
    setMemories(current => current.map(memory => memory.id === result.memory.id ? result.memory : memory));
    setViewer(result.memory);
    setViewerPhotoIndex(0);
    emitCoupleActivitiesChanged();
    revokeDrafts(editDrafts);
    setEditDrafts([]);
    setEditing(false);
    setPending(false);
  }

  async function removeCurrentMemory() {
    if (!viewer || !window.confirm(`‘${viewer.title}’ 추억과 연결된 사진을 삭제할까요?`)) return;
    setPending(true);
    setError("");
    const result = await deleteMemory(viewer.id);
    setPending(false);
    if ("error" in result) { setError(result.error); return; }
    setMemories(current => current.filter(memory => memory.id !== viewer.id));
    setViewer(null);
    setEditing(false);
    emitCoupleActivitiesChanged();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!persist) {
      setError("로그인 후 추억을 저장할 수 있어요.");
      return;
    }
    setPending(true);
    setError("");
    const selected = sortedPlaces.find(place => place.id === placeId);
    const uploaded = await uploadDrafts(drafts);
    if ("error" in uploaded) {
      setPending(false);
      setError(uploaded.error);
      return;
    }
    const parsedLat = latitude.trim() ? Number(latitude) : null;
    const parsedLng = longitude.trim() ? Number(longitude) : null;
    const hasManualCoordinates = Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
    const result = await createMemory({
      title,
      happenedOn,
      description,
      locationLabel: locationLabel || selected?.district || selected?.name || "",
      placeId: placeId || null,
      coverUrl: uploaded.photos[0]?.storagePath || coverUrl || selected?.image || "",
      lng: selected?.coordinates?.[0] ?? (hasManualCoordinates ? parsedLng : null),
      lat: selected?.coordinates?.[1] ?? (hasManualCoordinates ? parsedLat : null),
      memoryType,
      photos: uploaded.photos,
    });
    setPending(false);
    if ("error" in result) {
      if (uploaded.paths.length && session.mode === "authenticated") {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove(uploaded.paths);
      }
      setError(result.error);
      return;
    }
    setMemories(prev => [result.memory, ...prev]);
    emitCoupleActivitiesChanged();
    revokeDrafts(drafts);
    setDrafts([]);
    setOpen(false);
    setTitle("");
    setDescription("");
    setLocationLabel("");
    setPlaceId("");
    setCoverUrl("");
    setLatitude("");
    setLongitude("");
  }

  function layoutWall(mode: "scatter" | "reset") {
    const next = mode === "scatter"
      ? scatterCorkPoses(wallPieces.map(piece => piece.id))
      : Object.fromEntries(wallPieces.map((piece, index) => [piece.id, defaultCorkPose(index, wallPieces.length)]));
    setCorkPoses(next);
  }

  function renderList() {
    if (tab === "album") {
      if (!visible.length) {
        return (
          <div className="empty-soft">
            <h1>이 보기에 추억이 없어요</h1>
            <p>남긴 장면이 있으면 벽면과 앨범에서 다시 볼 수 있어요.</p>
            <button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button>
          </div>
        );
      }
      return (
        <ul className="memory-album">
          {tiles.map((tile, index) => (
            <li key={`${tile.memory.id}:${tile.image?.id ?? "note"}`} className={tile.image ? "" : "is-letter"} style={{ animationDelay: `${Math.min(index, 11) * 45}ms` }}>
              <WallFastener kind={fastenerFor(Boolean(tile.image), index)} />
              <button type="button" className="memory-album-open" onClick={() => openViewer(tile.memory, tile.photoIndex)}>
                <span className="memory-polaroid-media">
                  {tile.image ? <img src={tile.image.url} alt="" /> : <MemoryFace memory={tile.memory} size="card" />}
                  {tile.image && <MemoryTypeMark type={tile.memory.memoryType} className="memory-badge-ribbon" />}
                </span>
                <b>{tile.memory.title}</b>
                <small>{formatKoDate(tile.memory.happenedOn)}{tile.image && memoryImages(tile.memory).length > 1 ? ` · ${tile.photoIndex + 1}/${memoryImages(tile.memory).length}` : ""}</small>
              </button>
            </li>
          ))}
        </ul>
      );
    }
    if (tab !== "timeline" && !visible.length) {
      return (
        <div className="empty-soft">
          <h1>이 보기에 추억이 없어요</h1>
          <p>남긴 장면이 있으면 벽면과 앨범에서 다시 볼 수 있어요.</p>
          <button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button>
        </div>
      );
    }
    return (
      <MemoryCanvas
        coupleId={coupleKey}
        poses={corkPoses}
        setPoses={setCorkPoses}
        toolbarHost={tab === "timeline" ? wallToolbar : null}
        onScatter={() => layoutWall("scatter")}
        onReset={() => layoutWall("reset")}
      >
        {wallPieces.map((piece, index) => (
          <CorkPiece
            id={piece.id}
            key={piece.id}
            index={index}
            className={`is-${piece.kind}${piece.kind === "photo" ? ` is-${piece.size}` : ""}`}
            onOpen={piece.kind === "scrap" ? undefined : () => {
              const memory = displayMemories.find(item => item.id === piece.memoryId);
              if (memory) openViewer(memory, piece.kind === "photo" ? piece.photoIndex : 0);
            }}
            {...corkPieceProps}
          >
            {piece.kind === "photo" ? (
              <figure className={`memory-polaroid memory-cork-card is-${piece.size}`}>
                <WallFastener kind={fastenerFor(true, piece.photoIndex + index)} />
                <div className="memory-album-open">
                  <span className="memory-polaroid-media">
                    <img src={piece.url} alt="" draggable={false} />
                    <MemoryTypeMark type={piece.memoryType} className={`memory-badge-ribbon ${piece.size === "sm" ? "is-mini" : ""}`} />
                    {piece.photoCount > 1 && <span className="memory-photo-count">{piece.photoIndex + 1}/{piece.photoCount}</span>}
                  </span>
                </div>
                <figcaption>
                  <span>{formatKoDate(piece.happenedOn)}{piece.locationLabel && piece.size === "lg" ? ` · ${piece.locationLabel}` : ""}</span>
                  <h3>{piece.title}</h3>
                </figcaption>
              </figure>
            ) : piece.kind === "note" ? (
              <article className={`memory-lined-note is-${fastenerFor(false, index)}`}>
                <WallFastener kind={fastenerFor(false, index)} />
                <div className="memory-note-open">
                  <span className={`memory-lined-mark is-${piece.memoryType}`}>{MEMORY_TYPE_LABEL[piece.memoryType]}</span>
                  <h3>{piece.title}</h3>
                  <time>{formatKoDate(piece.happenedOn)}</time>
                  <p>{piece.description || piece.locationLabel || "사진 없이, 마음으로만 남겨둔 하루."}</p>
                </div>
              </article>
            ) : (
              <aside className="memory-scrap">
                <WallFastener kind="pin-left" />
                <p>{piece.quote}</p>
              </aside>
            )}
          </CorkPiece>
        ))}
      </MemoryCanvas>
    );
  }

  const metadataPending = drafts.some(item => item.pending) || editDrafts.some(item => item.pending);
  const firstDraft = drafts[0];

  return (
    <>
      <div className="page-title-row memory-page-header">
        <div>
          <span className="eyebrow">OUR ARCHIVE · {new Date().getFullYear()}</span>
          <h1>함께여서 기억나는 장면들</h1>
          <p>종이를 밀고 확대하며, 펜과 텍스트로 남긴 표시는 커플끼리 함께 보여요.</p>
        </div>
      </div>
      <div className="page-actions date-planner-actions trip-planner-actions memory-page-actions">
        <div className="memory-toolbar-row">
          <div className="memory-tabs" role="tablist" aria-label="추억 보기">
            {MEMORY_TABS.map(item => (
              <button className={`date-action-button ${tab === item.id ? "is-active" : ""}`} type="button" key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>
          <div className="date-action-group">
            <button className="date-action-button is-primary" type="button" onClick={openComposer}><HeaderActionIcon name="plus" /><span>추억 남기기</span></button>
          </div>
        </div>
        <div className="memory-toolbar-cluster" ref={setWallToolbar} hidden={tab !== "timeline"} />
      </div>

      <div key={tab} className="memory-tab-panel">
        {tab === "map" ? (
          mappedMemories.length ? (
            <section className="memory-map-list paper-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">ON THE MAP</span>
                  <h2>좌표가 있는 추억</h2>
                </div>
                <Link className="quiet-link" href="/our-map">Our Map 열기 →</Link>
              </div>
              <ul>
                {mappedMemories.map(item => {
                  const image = memoryImages(item)[0];
                  return (
                    <li key={item.id}>
                      <button type="button" className="memory-map-open" onClick={() => openViewer(item)}>
                        {image ? <img src={image.url} alt="" /> : <span className="memory-map-letter" />}
                        <span>
                          <b>{item.title}</b>
                          <small>{formatKoDate(item.happenedOn)}{item.locationLabel ? ` · ${item.locationLabel}` : ""}{memoryImages(item).length > 1 ? ` · 사진 ${memoryImages(item).length}장` : ""}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {visible.some(item => !item.coordinates) && (
                <p className="form-hint">좌표가 없는 기록은 벽면에서만 보여요. 장소를 연결하면 지도에도 올라갑니다.</p>
              )}
            </section>
          ) : (
            <div className="empty-soft">
              <h1>지도에 올릴 좌표가 없어요</h1>
              <p>추억을 남길 때 저장한 장소를 고르면 Our Map에 핀이 생겨요.</p>
              <div className="dialog-actions">
                <button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button>
                <Link className="outline-button" href="/our-map">Our Map 열기</Link>
              </div>
            </div>
          )
        ) : renderList()}
      </div>

      {open && (
        <div className="dialog-backdrop" role="presentation" onClick={closeComposer}>
          <form className="place-create-dialog memory-dialog" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div>
                <span className="eyebrow">NEW MEMORY · {createStep === "photo" ? "1 / 2" : "2 / 2"}</span>
                <h2>{createStep === "photo" ? "오늘의 장면을 골라요" : "이 장면에 이름을 붙여요"}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={closeComposer}>×</button>
            </div>
            <div className="memory-step-track" aria-label="기억 만들기 진행 단계"><i className={createStep === "story" ? "is-complete" : ""} /><i /></div>
            {createStep === "photo" ? <>
              {drafts.length ? (
                <div className="memory-photo-grid" aria-label="선택한 사진">
                  {drafts.map(draft => (
                    <figure className="memory-photo-draft" key={draft.key}>
                      <img src={draft.preview} alt="" />
                      <button className="memory-photo-draft-remove" type="button" aria-label="사진 빼기" onClick={() => removeDraft(draft.key, "create")}>×</button>
                      {draft.pending && <span className="memory-photo-draft-status">읽는 중</span>}
                    </figure>
                  ))}
                  {drafts.length < MAX_MEMORY_PHOTOS && (
                    <label className="memory-photo-add">
                      <b>+</b>
                      <span>사진 추가</span>
                      <input type="file" accept={MEMORY_PHOTO_ACCEPT} multiple onChange={event => { const files = event.target.files; event.target.value = ""; void addDrafts(files, "create"); }} />
                    </label>
                  )}
                </div>
              ) : (
                <label className="memory-photo-drop">
                  <div>
                    <b>사진을 한 장 이상 고르세요</b>
                    <span>여러 장을 한 번에 붙이면 벽면에 모두 펼쳐져요</span>
                    <small>JPG · PNG · WEBP · HEIC, 장당 20MB, 최대 {MAX_MEMORY_PHOTOS}장</small>
                  </div>
                  <input type="file" accept={MEMORY_PHOTO_ACCEPT} multiple onChange={event => { const files = event.target.files; event.target.value = ""; void addDrafts(files, "create"); }} />
                </label>
              )}
              {firstDraft && (
                <div className="photo-analysis-result">
                  <div>
                    <span className={metadataPending ? "is-reading" : ""}>{metadataPending ? "분석 중" : "분석 완료"}</span>
                    <b>{drafts.length}장의 장면</b>
                  </div>
                  <ul>
                    <li><span>촬영일</span><b>{firstDraft.meta?.capturedAt ? new Date(firstDraft.meta.capturedAt).toLocaleString("ko-KR") : "정보 없음 · 다음 단계에서 입력"}</b></li>
                    <li><span>위치</span><b>{firstDraft.meta?.locationSource === "exif" ? `${latitude}, ${longitude}` : "GPS 없음 · 다음 단계에서 연결"}</b></li>
                    <li><span>카메라</span><b>{[firstDraft.meta?.cameraMake, firstDraft.meta?.cameraModel].filter(Boolean).join(" ") || "정보 없음"}</b></li>
                  </ul>
                </div>
              )}
              <p className="memory-privacy-note">원본 사진은 우리만 접근할 수 있는 비공개 보관함에 저장됩니다.</p>
              <div className="dialog-actions">
                <button className="outline-button" type="button" onClick={closeComposer}>취소</button>
                <button className="text-button" type="button" onClick={continueToStory}>사진 없이 기록</button>
                <button className="primary-button" type="button" onClick={continueToStory} disabled={metadataPending}>{drafts.length ? "이 장면으로 계속" : "다음"}</button>
              </div>
            </> : <>
              <div className="memory-story-preview is-stack">
                {drafts.length ? drafts.slice(0, 3).map((draft, index) => (
                  <img src={draft.preview} alt="" key={draft.key} style={{ transform: `rotate(${(index - 1) * 4}deg)` }} />
                )) : <div>NO PHOTO</div>}
                <button type="button" onClick={() => setCreateStep("photo")}>{drafts.length ? `사진 ${drafts.length}장 변경` : "사진 변경"}</button>
              </div>
              <label className="field memory-title-field"><span>이 기억의 제목</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="계획 없이 걷던 토요일" required autoFocus /></label>
              <label className="field"><span>한 줄 기록 <small>선택</small></span><textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="그날 가장 오래 기억하고 싶은 순간은?" rows={3} /></label>
              <div className="memory-fact-grid"><label className="field"><span>날짜</span><input type="date" value={happenedOn} onChange={event => setHappenedOn(event.target.value)} required /></label><label className="field"><span>기억 종류</span><select value={memoryType} onChange={event => setMemoryType(event.target.value as MemoryType)}><option value="free">그날의 기록</option><option value="trip">여행</option><option value="date">데이트</option></select></label></div>
              <label className="field"><span>연결된 장소 <small>선택</small></span><select value={placeId} onChange={event => setPlaceId(event.target.value)}><option value="">직접 적기</option>{sortedPlaces.map(place => <option key={place.id} value={place.id}>{place.name} · {place.district}</option>)}</select></label>
              <label className="field"><span>장소 이름</span><input value={locationLabel} onChange={event => setLocationLabel(event.target.value)} placeholder="성수 · 카페 골목" /></label>
              <details className="memory-location-details"><summary>지도 위치 세밀하게 조정</summary><div className="coordinate-fields"><label className="field"><span>위도</span><input inputMode="decimal" value={latitude} onChange={event => setLatitude(event.target.value)} /></label><label className="field"><span>경도</span><input inputMode="decimal" value={longitude} onChange={event => setLongitude(event.target.value)} /></label></div></details>
              {!drafts.length && <label className="field"><span>사진 URL <small>선택</small></span><input value={coverUrl} onChange={event => setCoverUrl(event.target.value)} placeholder="https://..." /></label>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setCreateStep("photo")} disabled={pending}>이전</button><button className="primary-button" type="submit" disabled={pending}>{pending ? "우리의보관함에 저장 중..." : "기억으로 남기기"}</button></div>
            </>}
          </form>
        </div>
      )}
      {viewer && (
        <div className="dialog-backdrop memory-viewer-backdrop" role="presentation" onClick={() => !pending && closeViewer()}>
          <article
            className={`memory-viewer memory-viewer-sheet ${editing ? "is-editing" : ""} ${activeViewerImage && !coverFailed ? "has-photo" : "is-text-only"}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-viewer-title"
            onClick={event => event.stopPropagation()}
          >
            {!editing ? (
              <>
                <header className="memory-viewer-header">
                  <div className="memory-viewer-header-copy">
                    <span className="memory-viewer-eyebrow">OUR MEMORY</span>
                    {viewerImages.length > 1 ? (
                      <span className="memory-viewer-index" aria-live="polite">{viewerPhotoIndex + 1} / {viewerImages.length}</span>
                    ) : null}
                  </div>
                  <div className="memory-viewer-toolbar memory-viewer-header-toolbar" role="toolbar" aria-label="기억 보기">
                    <button className="memory-viewer-btn memory-viewer-btn--danger" type="button" disabled={pending} onClick={() => void removeCurrentMemory()}>
                      삭제
                    </button>
                    <button className="memory-viewer-btn memory-viewer-btn--ghost" type="button" onClick={() => beginEdit(viewer)}>수정</button>
                    <button className="memory-viewer-btn memory-viewer-btn--primary" type="button" onClick={closeViewer}>확인</button>
                  </div>
                </header>
                <div className="memory-viewer-layout">
                  <div className="memory-viewer-stage" aria-label="추억 사진">
                    {activeViewerImage && !coverFailed ? (
                      <img
                        className="memory-viewer-photo"
                        src={activeViewerImage.url}
                        alt=""
                        onError={() => setCoverFailed(true)}
                      />
                    ) : (
                      <div className="memory-viewer-fallback">
                        <MemoryFace memory={viewer} size="hero" imageClassName="memory-viewer-photo" />
                      </div>
                    )}
                    {activeViewerImage && !coverFailed ? <MemoryTypeMark type={viewer.memoryType} className="memory-badge-ribbon" /> : null}
                    {viewerImages.length > 1 && activeViewerImage && !coverFailed ? (
                      <>
                        <button
                          type="button"
                          className="memory-viewer-nav is-prev"
                          aria-label="이전 사진"
                          onClick={() => {
                            setCoverFailed(false);
                            setViewerPhotoIndex(index => (index - 1 + viewerImages.length) % viewerImages.length);
                          }}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="memory-viewer-nav is-next"
                          aria-label="다음 사진"
                          onClick={() => {
                            setCoverFailed(false);
                            setViewerPhotoIndex(index => (index + 1) % viewerImages.length);
                          }}
                        >
                          ›
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div className="memory-viewer-body">
                    {viewerImages.length > 1 ? (
                      <div className="memory-viewer-thumbs" role="list" aria-label="사진 선택">
                        {viewerImages.map((image, index) => (
                          <button
                            type="button"
                            key={image.id}
                            className={index === viewerPhotoIndex ? "is-active" : ""}
                            aria-label={`사진 ${index + 1}`}
                            aria-current={index === viewerPhotoIndex ? "true" : undefined}
                            onClick={() => {
                              setCoverFailed(false);
                              setViewerPhotoIndex(index);
                            }}
                          >
                            <img src={image.url} alt="" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <p className="memory-viewer-meta">
                      {formatKoDate(viewer.happenedOn)}
                      {viewer.locationLabel ? ` · ${viewer.locationLabel}` : ""}
                    </p>
                    <h2 id="memory-viewer-title">{viewer.title}</h2>
                    <p className="memory-viewer-lead">{viewer.description || "그날의 장면."}</p>
                    {viewer.photos[viewerPhotoIndex] ? (
                      <ul className="memory-viewer-facts" aria-label="사진 정보">
                        <li>
                          {viewer.photos[viewerPhotoIndex].capturedAt
                            ? `촬영 ${new Date(viewer.photos[viewerPhotoIndex].capturedAt!).toLocaleString("ko-KR")}`
                            : "촬영일 정보 없음"}
                        </li>
                        <li>
                          {[viewer.photos[viewerPhotoIndex].cameraMake, viewer.photos[viewerPhotoIndex].cameraModel].filter(Boolean).join(" ")
                            || "카메라 정보 없음"}
                        </li>
                        {viewer.coordinates ? (
                          <li className="is-action">
                            <Link className="memory-viewer-map-link" href="/our-map">지도에서 보기</Link>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                    {error ? <p className="form-error" role="alert">{error}</p> : null}
                  </div>
                </div>
              </>
            ) : (
              <form className="memory-edit-form" onSubmit={event => void saveEdit(event)}>
                <div className="memory-edit-head">
                  <span className="eyebrow">EDIT MEMORY</span>
                  <h2>이 장면을 다듬어요</h2>
                </div>
                <div className="memory-photo-grid is-edit" aria-label="추억 사진">
                  {memoryImages(viewer).map(image => (
                    <figure className="memory-photo-draft is-saved" key={image.id}>
                      <img src={image.url} alt="" />
                    </figure>
                  ))}
                  {editDrafts.map(draft => (
                    <figure className="memory-photo-draft" key={draft.key}>
                      <img src={draft.preview} alt="" />
                      <button className="memory-photo-draft-remove" type="button" aria-label="사진 빼기" onClick={() => removeDraft(draft.key, "edit")}>×</button>
                    </figure>
                  ))}
                  {memoryImages(viewer).length + editDrafts.length < MAX_MEMORY_PHOTOS && (
                    <label className="memory-photo-add">
                      <b>+</b>
                      <span>사진 추가</span>
                      <input type="file" accept={MEMORY_PHOTO_ACCEPT} multiple onChange={event => { const files = event.target.files; event.target.value = ""; void addDrafts(files, "edit"); }} />
                    </label>
                  )}
                </div>
                <label className="field memory-title-field">
                  <span>제목</span>
                  <input value={editTitle} onChange={event => setEditTitle(event.target.value)} placeholder="그날의 이름" required />
                </label>
                <label className="field">
                  <span>한 줄 기록 <small>선택</small></span>
                  <textarea rows={3} value={editDescription} onChange={event => setEditDescription(event.target.value)} placeholder="오래 기억하고 싶은 순간" />
                </label>
                <div className="memory-edit-meta">
                  <label className="field">
                    <span>날짜</span>
                    <input type="date" value={editDate} onChange={event => setEditDate(event.target.value)} required />
                  </label>
                  <div className="field">
                    <span>종류</span>
                    <div className="memory-type-pills" role="group" aria-label="기억 종류">
                      {(["free", "trip", "date"] as const).map(type => (
                        <button className={editType === type ? "is-active" : ""} type="button" key={type} aria-pressed={editType === type} onClick={() => setEditType(type)}>
                          {MEMORY_TYPE_LABEL[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <label className="field">
                  <span>장소 <small>선택</small></span>
                  <input value={editLocation} onChange={event => setEditLocation(event.target.value)} placeholder="성수 · 카페 골목" />
                </label>
                <details className="memory-location-details">
                  <summary>지도 위치</summary>
                  <div className="coordinate-fields">
                    <label className="field"><span>위도</span><input inputMode="decimal" value={editLatitude} onChange={event => setEditLatitude(event.target.value)} /></label>
                    <label className="field"><span>경도</span><input inputMode="decimal" value={editLongitude} onChange={event => setEditLongitude(event.target.value)} /></label>
                  </div>
                </details>
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="dialog-actions"><button className="outline-button" type="button" onClick={cancelEdit} disabled={pending}>취소</button><button className="primary-button" type="submit" disabled={pending || metadataPending}>{pending ? "저장 중..." : "변경 저장"}</button></div>
              </form>
            )}
          </article>
        </div>
      )}
    </>
  );
}
