"use client";

import { Fragment, useMemo, useState, useEffect, useRef } from "react";
import { AppLink as Link } from "@/components/layout/AppLink";
import { ExpandableText } from "@/components/shared/ExpandableText";
import { PlaceLocationMap } from "@/features/places/components/PlaceLocationMap";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { SyncNotice } from "@/components/shared/SyncNotice";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { memoryEditSnapshot } from "../editSnapshot";
import { createMemory, deleteMemory, updateMemory, readMemoryWorkspace } from "../actions";
import { parseMemoryCoordinates } from "../memoryCoordinates";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import type { CreateMemoryInput, Memory, MemoryType, PhotoMetadataInput, UpdateMemoryInput } from "../types";
import type { Place } from "@/features/places/types/place";
import { formatKoDate, isIsoDate, seoulTodayIso, toIsoDate } from "@/lib/dates";
import styles from "./MemoryTimeline.module.css";
import { CorkPiece } from "./CorkPiece";
import { MemoryCanvas } from "./MemoryCanvas";
import {
  defaultCorkPose,
  scatterCorkPoses,
  type CorkPose,
} from "../corkLayout";
import { inspectMemoryPhoto } from "../photoInspect";
import { createPhotoDraftLifecycle } from "../photoDraftLifecycle";
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

function MemoryFace({ memory, size = "card", imageClassName, skipImage = false }: { memory: Memory; size?: "hero" | "card" | "mini"; imageClassName?: string; skipImage?: boolean }) {
  const image = memoryImages(memory)[0];
  if (image && !skipImage) return <img loading="lazy" decoding="async" className={imageClassName} src={image.url} alt="" />;
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
  places: initialPlaces,
  persist,
}: {
  initialMemories: Memory[];
  places: Place[];
  persist: boolean;
}) {
  const session = useAppSession();
  const [memories, setMemories] = useState(initialMemories);
  const [places, setPlaces] = useState(initialPlaces);
  const [photoError, setPhotoError] = useState(false);
  const [photoRetry, setPhotoRetry] = useState(0);
  const displayMemories = useResolvedMemories(memories, photoRetry, setPhotoError);
  const [tab, setTab] = useState<MemoryTab>("timeline");
  const [query, setQuery] = useState("");
  const [mapMemoryId, setMapMemoryId] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [open, setOpen] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("photo");
  const [pending, setPending] = useState(false);
  const [awaitingCreation, setAwaitingCreation] = useState(false);
  const creationAttemptRef = useRef<{ input: CreateMemoryInput; paths: string[] } | null>(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
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
  const [awaitingEdit, setAwaitingEdit] = useState(false);
  const editAttemptRef = useRef<{ input: UpdateMemoryInput; paths: string[] } | null>(null);
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
  const wallScope = `${coupleKey}:${session.mode === "authenticated" ? session.userId : "guest"}`;
  const [corkPoses, setCorkPoses] = useState<Record<string, CorkPose>>({});
  const [corkDraggingId, setCorkDraggingId] = useState<string | null>(null);
  const [wallToolbar, setWallToolbar] = useState<HTMLDivElement | null>(null);
  const draftsRef = useRef(drafts);
  const editDraftsRef = useRef(editDrafts);
  const createInspections = useRef(createPhotoDraftLifecycle());
  const editInspections = useRef(createPhotoDraftLifecycle());
  draftsRef.current = drafts;
  editDraftsRef.current = editDrafts;

  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const composerRef = useDialogFocus<HTMLFormElement>({ open, onClose: closeComposer });
  const viewerRef = useDialogFocus<HTMLElement>({
    open: Boolean(viewer), onClose: closeViewer, initialFocus: "#memory-viewer-title",
  });
  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    try {
      const remote = await readMemoryWorkspace();
      if (!isCurrent() || pendingRef.current) return;
      setMemories(remote.memories);
      setPlaces(remote.places);
      setSyncError("");
    } catch {
      if (isCurrent()) setSyncError("최신 추억을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    }
  }, { tables: ["memories", "memory_photos", "places"], activityPrefixes: ["MEMORY_", "PLACE_"] });

  useEffect(() => {
    setHappenedOn(current => current || seoulTodayIso());
  }, []);

  useEffect(() => {
    if (!editing) setViewer(current => current ? displayMemories.find(memory => memory.id === current.id) ?? null : null);
  }, [displayMemories, editing]);

  useEffect(() => () => {
    createInspections.current.clear();
    editInspections.current.clear();
    revokeDrafts(draftsRef.current);
    revokeDrafts(editDraftsRef.current);
  }, []);

  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [places],
  );
  const visible = useMemo(() => {
    const needle = tab === "timeline" ? "" : query.trim().toLocaleLowerCase("ko");
    return displayMemories.filter(item => (tab !== "trip" || item.memoryType === "trip") && (tab !== "date" || item.memoryType === "date")
      && (!needle || `${item.title} ${item.description} ${item.locationLabel} ${item.happenedOn}`.toLocaleLowerCase("ko").includes(needle)))
      .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn) || b.createdAt.localeCompare(a.createdAt));
  }, [displayMemories, tab, query]);
  const wallPieces = useMemo(() => buildWallPieces(visible), [visible]);
  const tiles = useMemo(() => albumTiles(visible), [visible]);
  const mappedMemories = useMemo(() => visible.filter(item => item.coordinates), [visible]);
  const mapMemory = mappedMemories.find(item => item.id === mapMemoryId) ?? mappedMemories[0];
  const viewerImages = viewer ? memoryImages(viewer) : [];
  const activeViewerImage = viewerImages[viewerPhotoIndex] ?? viewerImages[0] ?? null;
  const activeViewerPhoto = viewer?.photos.find(photo => photo.id === activeViewerImage?.id);
  useEffect(() => {
    setViewerPhotoIndex(index => Math.min(index, Math.max(0, viewerImages.length - 1)));
  }, [viewer?.id, viewerImages.length]);
  useEffect(() => {
    setCoverFailed(false);
  }, [viewer?.id, viewerPhotoIndex, activeViewerImage?.url]);

  useEffect(() => {
    if (!viewer || editing) return;
    const count = viewerImages.length;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || open) return;
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
  }, [viewer, editing, viewerImages.length, open]);

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
    if (!files?.length || pendingRef.current) return;
    const current = target === "create" ? draftsRef.current : editDraftsRef.current;
    const room = MAX_MEMORY_PHOTOS - current.length - (target === "edit" && viewer ? viewer.photos.length : 0);
    const allowed = [...files].filter(file => file.size > 0 && file.size <= MAX_MEMORY_PHOTO_BYTES
      && (/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(file.type) || (!file.type && /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name))));
    if (allowed.length !== files.length) setError("지원하는 사진 형식과 장당 20MB 제한을 확인해 주세요.");
    const incoming = allowed.slice(0, Math.max(0, room));
    if (!incoming.length) {
      if (room <= 0) setError(`사진은 최대 ${MAX_MEMORY_PHOTOS}장까지 붙일 수 있어요.`);
      return;
    }
    if (allowed.length > room) setError(`사진은 최대 ${MAX_MEMORY_PHOTOS}장까지 붙일 수 있어요. 초과한 사진은 추가하지 않았어요.`);
    const next: PhotoDraft[] = incoming.map(file => ({
      key: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      meta: null,
      pending: true,
    }));
    const emptyBefore = current.length === 0;
    const inspections = target === "create" ? createInspections.current : editInspections.current;
    inspections.add(next.map(draft => draft.key));
    if (target === "create") {
      draftsRef.current = [...current, ...next];
      setDrafts(draftsRef.current);
    } else {
      editDraftsRef.current = [...current, ...next];
      setEditDrafts(editDraftsRef.current);
    }
    await inspections.inspect(next, inspectMemoryPhoto, (draft, meta, index) => {
      if (target === "create") {
        setDrafts(items => items.map(item => item.key === draft.key ? { ...item, meta, pending: false } : item));
        if (emptyBefore && index === 0) applyPhotoFacts(meta, true);
      } else {
        setEditDrafts(items => items.map(item => item.key === draft.key ? { ...item, meta, pending: false } : item));
      }
    });
  }

  function removeDraft(key: string, target: "create" | "edit") {
    if (pendingRef.current) return;
    const list = target === "create" ? draftsRef.current : editDraftsRef.current;
    const found = list.find(item => item.key === key);
    if (found?.preview.startsWith("blob:")) URL.revokeObjectURL(found.preview);
    if (target === "create") {
      createInspections.current.remove(key);
      draftsRef.current = list.filter(item => item.key !== key);
      setDrafts(draftsRef.current);
    } else {
      editInspections.current.remove(key);
      editDraftsRef.current = list.filter(item => item.key !== key);
      setEditDrafts(editDraftsRef.current);
    }
  }

  function openComposer() {
    if (!creationAttemptRef.current) setMemoryType(tab === "trip" || tab === "date" ? tab : "free");
    setCreateStep(creationAttemptRef.current ? "story" : "photo");
    setError("");
    setOpen(true);
  }

  function closeComposer() {
    if (pendingRef.current) return;
    if (creationAttemptRef.current) { setOpen(false); return; }
    createInspections.current.clear();
    revokeDrafts(drafts);
    draftsRef.current = [];
    setDrafts([]);
    setTitle(""); setDescription(""); setLocationLabel(""); setPlaceId("");
    setCoverUrl(""); setLatitude(""); setLongitude(""); setHappenedOn(seoulTodayIso()); setMemoryType("free");
    setOpen(false);
  }

  function continueToStory(event: React.MouseEvent<HTMLButtonElement>) {
    // A step change can replace this DOM button with a submit button before the
    // browser runs the click's default action. Cancel it before changing state.
    event.preventDefault();
    if (draftsRef.current.some(draft => draft.pending)) return;
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
    if (pendingRef.current || awaitingEdit) return;
    editAttemptRef.current = null;
    setEditTitle(memory.title);
    setEditDate(memory.happenedOn);
    setEditDescription(memory.description);
    setEditLocation(memory.locationLabel);
    setEditLongitude(memory.coordinates?.[0]?.toString() ?? "");
    setEditLatitude(memory.coordinates?.[1]?.toString() ?? "");
    setEditType(memory.memoryType);
    revokeDrafts(editDrafts);
    editInspections.current.clear();
    editDraftsRef.current = [];
    setEditDrafts([]);
    setError("");
    setEditConflict(false);
    setEditing(true);
  }

  function closeViewer() {
    if (pendingRef.current || awaitingEdit) return;
    editInspections.current.clear();
    revokeDrafts(editDrafts);
    editDraftsRef.current = [];
    setEditDrafts([]);
    setEditing(false);
    setViewer(null);
  }

  function cancelEdit() {
    if (pendingRef.current || awaitingEdit) return;
    editAttemptRef.current = null;
    editInspections.current.clear();
    revokeDrafts(editDrafts);
    editDraftsRef.current = [];
    setEditDrafts([]);
    setEditing(false);
    setViewer(current => current ? displayMemories.find(memory => memory.id === current.id) ?? null : null);
    setError("");
    retrySync();
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
    setUploadProgress({ done: 0, total: items.length });
    try {
      let cursor = 0;
      let done = 0;
      const upload = async () => {
        while (cursor < items.length) {
          const index = cursor++;
          const draft = items[index];
          const ext = (draft.file.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${session.coupleId}/${crypto.randomUUID()}.${ext}`;
          paths.push(path);
          const contentType = draft.file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" } as Record<string, string>)[ext];
          const uploaded = await supabase.storage.from("memory-photos").upload(path, draft.file, { contentType, upsert: false });
          if (uploaded.error) throw new Error("사진을 올리지 못했어요.");
          photos[index] = { ...draft.meta, storagePath: path };
          setUploadProgress({ done: ++done, total: items.length });
        }
      };
      const results = await Promise.allSettled(Array.from({ length: Math.min(3, items.length) }, upload));
      if (results.some(result => result.status === "rejected")) throw new Error("upload failed");
    } catch {
      if (paths.length) await supabase.storage.from("memory-photos").remove(paths).catch(() => undefined);
      return { error: "사진을 올리지 못했어요. 연결을 확인하고 다시 시도해 주세요." };
    } finally {
      setUploadProgress(null);
    }
    return { photos, paths };
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!viewer || editDraftsRef.current.some(draft => draft.pending)) return;
    if (session.mode !== "authenticated") {
      setError("로그인 후 추억을 수정할 수 있어요.");
      return;
    }
    if (pendingRef.current) return;
    if (!editAttemptRef.current && (!editTitle.trim() || editTitle.length > 500 || !isIsoDate(editDate))) {
      setError("추억 제목과 날짜를 확인해 주세요."); return;
    }
    const coordinates = editAttemptRef.current ? null : parseMemoryCoordinates(editLatitude, editLongitude);
    if (coordinates && "error" in coordinates) { setError(coordinates.error); return; }
    pendingRef.current = true;
    setPending(true);
    setError("");
    setEditConflict(false);
    const uploaded = editAttemptRef.current
      ? { photos: editAttemptRef.current.input.photos ?? [], paths: editAttemptRef.current.paths }
      : await uploadDrafts(editDrafts).catch(() => ({ error: "사진을 올리지 못했어요. 연결을 확인하고 다시 시도해 주세요." }));
    if ("error" in uploaded) {
      pendingRef.current = false;
      setPending(false);
      setError(uploaded.error);
      return;
    }
    const input: UpdateMemoryInput = editAttemptRef.current?.input ?? {
      id: viewer.id,
      attemptId: crypto.randomUUID(),
      expectedSnapshot: memoryEditSnapshot(viewer),
      title: editTitle,
      happenedOn: editDate,
      description: editDescription,
      locationLabel: editLocation,
      memoryType: editType,
      lat: coordinates && "coordinates" in coordinates ? coordinates.coordinates?.[1] ?? null : null,
      lng: coordinates && "coordinates" in coordinates ? coordinates.coordinates?.[0] ?? null : null,
      photos: uploaded.photos,
    };
    editAttemptRef.current = { input, paths: uploaded.paths };
    const result = await updateMemory(input).catch(() => ({ error: "저장 응답을 받지 못했어요. 같은 내용으로 다시 시도해 주세요.", keepUploadedPhotos: true }));
    if ("error" in result) {
      if (uploaded.paths.length && !result.keepUploadedPhotos) {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove(uploaded.paths).catch(() => undefined);
      }
      pendingRef.current = false;
      setPending(false);
      setAwaitingEdit(Boolean(result.keepUploadedPhotos));
      setEditConflict(Boolean(result.conflict));
      if (!result.keepUploadedPhotos) editAttemptRef.current = null;
      setError(result.error);
      retrySync();
      return;
    }
    editAttemptRef.current = null;
    setAwaitingEdit(false);
    setMemories(current => current.map(memory => memory.id === result.memory.id ? result.memory : memory));
    setViewer(result.memory);
    setViewerPhotoIndex(0);
    emitCoupleActivitiesChanged();
    revokeDrafts(editDrafts);
    editInspections.current.clear();
    editDraftsRef.current = [];
    setEditDrafts([]);
    setEditing(false);
    pendingRef.current = false;
    setPending(false);
  }

  async function removeCurrentMemory() {
    if (!viewer || !window.confirm(`‘${viewer.title}’ 추억과 연결된 사진을 삭제할까요?`)) return;
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    const result = await deleteMemory(viewer.id).catch(() => ({ error: "삭제 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }));
    pendingRef.current = false;
    setPending(false);
    if ("error" in result) { setError(result.error); retrySync(); return; }
    setMemories(current => current.filter(memory => memory.id !== viewer.id));
    setViewer(null);
    setEditing(false);
    emitCoupleActivitiesChanged();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (createStep !== "story") return;
    if (draftsRef.current.some(draft => draft.pending)) return;
    if (!persist) {
      setError("로그인 후 추억을 저장할 수 있어요.");
      return;
    }
    if (!creationAttemptRef.current && (!title.trim() || title.length > 500 || !isIsoDate(happenedOn))) {
      setError("추억 제목과 날짜를 확인해 주세요."); return;
    }
    const selected = sortedPlaces.find(place => place.id === placeId);
    const location = parseMemoryCoordinates(latitude, longitude, selected?.coordinates);
    if ("error" in location) { setError(location.error); return; }
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    const uploaded = creationAttemptRef.current
      ? { photos: creationAttemptRef.current.input.photos ?? [], paths: creationAttemptRef.current.paths }
      : await uploadDrafts(drafts).catch(() => ({ error: "사진을 올리지 못했어요. 연결을 확인하고 다시 시도해 주세요." }));
    if ("error" in uploaded) {
      pendingRef.current = false;
      setPending(false);
      setError(uploaded.error);
      return;
    }
    const input: CreateMemoryInput = creationAttemptRef.current?.input ?? {
      attemptId: crypto.randomUUID(),
      title,
      happenedOn,
      description,
      locationLabel: locationLabel || selected?.district || selected?.name || "",
      placeId: placeId || null,
      coverUrl: uploaded.photos[0]?.storagePath || coverUrl || selected?.image || "",
      lng: location.coordinates?.[0] ?? null,
      lat: location.coordinates?.[1] ?? null,
      memoryType,
      photos: uploaded.photos,
    };
    creationAttemptRef.current = { input, paths: uploaded.paths };
    const result = await createMemory(input).catch(() => ({ error: "저장 응답을 받지 못했어요. 같은 내용으로 다시 시도해 주세요.", keepUploadedPhotos: true }));
    pendingRef.current = false;
    setPending(false);
    if ("error" in result) {
      if (uploaded.paths.length && !result.keepUploadedPhotos && session.mode === "authenticated") {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove(uploaded.paths).catch(() => undefined);
      }
      setAwaitingCreation(Boolean(result.keepUploadedPhotos));
      if (!result.keepUploadedPhotos) creationAttemptRef.current = null;
      setError(result.error);
      retrySync();
      return;
    }
    creationAttemptRef.current = null;
    setAwaitingCreation(false);
    setMemories(prev => [result.memory, ...prev.filter(memory => memory.id !== result.memory.id)]);
    emitCoupleActivitiesChanged();
    revokeDrafts(drafts);
    createInspections.current.clear();
    draftsRef.current = [];
    setDrafts([]);
    setOpen(false);
    setTitle("");
    setDescription("");
    setLocationLabel("");
    setPlaceId("");
    setCoverUrl("");
    setLatitude("");
    setLongitude("");
    setHappenedOn(seoulTodayIso());
    setMemoryType("free");
  }

  function layoutWall(mode: "scatter" | "reset") {
    const next = mode === "scatter"
      ? scatterCorkPoses(wallPieces.map(piece => piece.id))
      : Object.fromEntries(wallPieces.map((piece, index) => [piece.id, defaultCorkPose(index, wallPieces.length)]));
    setCorkPoses(next);
  }

  function renderList() {
    if (tab === "trip" || tab === "date") return visible.length ? (
      <section className={styles.journal} aria-label={`${tab === "trip" ? "여행" : "데이트"} 기록`}>
        {visible.map(memory => <article key={memory.id} className={styles.journalCard}>
          <button type="button" onClick={() => openViewer(memory)} aria-label={`${memory.title} 기록 열기`}>
            <div className={styles.journalImage}><MemoryFace memory={memory} size="card" /><span>{MEMORY_TYPE_LABEL[memory.memoryType]}</span></div>
            <div className={styles.journalBody}><time dateTime={memory.happenedOn}>{formatKoDate(memory.happenedOn)}</time><h2>{memory.title}</h2><p>{memory.description || memory.locationLabel || "우리만 기억하는 하루"}</p><small>{memory.photos.length ? `사진 ${memory.photos.length}장 · ` : ""}기록 열기 ↗</small></div>
          </button>
        </article>)}
      </section>
    ) : <div className="empty-soft"><h2>{query.trim() ? "찾는 기록이 없어요" : `아직 ${tab === "trip" ? "여행" : "데이트"} 기록이 없어요`}</h2><p>{query.trim() ? "다른 검색어로 찾아보세요." : "함께한 하루를 사진과 글로 남겨 보세요."}</p><button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button></div>;
    if (tab === "album") {
      if (!visible.length) {
        return (
          <div className="empty-soft">
            <h2>{query.trim() ? "찾는 기록이 없어요" : "아직 앨범에 추억이 없어요"}</h2>
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
                  {tile.image ? <img loading="lazy" decoding="async" src={tile.image.url} alt="" /> : <MemoryFace memory={tile.memory} size="card" />}
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
        key={wallScope}
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
                    <img loading="lazy" decoding="async" src={piece.url} alt="" draggable={false} />
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
      <SyncNotice message={syncError} onRetry={retrySync} />
      <SyncNotice message={photoError ? "추억 사진 일부를 불러오지 못했어요. 기록은 유지되니 다시 시도해 주세요." : ""} onRetry={() => setPhotoRetry(current => current + 1)} />
      <div className="page-title-row memory-page-header">
        <div>
          <span className="eyebrow">OUR ARCHIVE · {new Date().getFullYear()}</span>
          <h1>함께여서 기억나는 장면들</h1>
          <p>둘의 사진과 기록을 모으고, 벽면에 마음을 더해요.</p>
          <div className={styles.stats}><span>기록 <b>{memories.length}</b></span><span>사진 <b>{memories.reduce((count, memory) => count + memory.photos.length, 0)}</b></span><span>지도에 남긴 순간 <b>{memories.filter(memory => memory.coordinates).length}</b></span></div>
        </div>
      </div>
      <div className="page-actions date-planner-actions trip-planner-actions memory-page-actions">
        <div className="memory-toolbar-row">
          <div className="memory-tabs" role="tablist" aria-label="추억 보기">
            {MEMORY_TABS.map(item => (
              <button className={`date-action-button ${tab === item.id ? "is-active" : ""}`} type="button" key={item.id} role="tab" id={`memory-tab-${item.id}`} aria-controls="memory-content-panel" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} onClick={() => setTab(item.id)} onKeyDown={event => {
                const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!direction && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const index = event.key === "Home" ? 0 : event.key === "End" ? MEMORY_TABS.length - 1 : (MEMORY_TABS.findIndex(value => value.id === item.id) + direction + MEMORY_TABS.length) % MEMORY_TABS.length;
                setTab(MEMORY_TABS[index].id);
                document.getElementById(`memory-tab-${MEMORY_TABS[index].id}`)?.focus();
              }}>{item.label}</button>
            ))}
          </div>
          <div className="date-action-group">
            <button className="date-action-button is-primary" type="button" onClick={openComposer}><HeaderActionIcon name="plus" /><span>추억 남기기</span></button>
          </div>
        </div>
        <div className="memory-toolbar-cluster" ref={setWallToolbar} hidden={tab !== "timeline"} />
      </div>

      {tab !== "timeline" && <div className={styles.searchRow}><span>{visible.length}개의 기록</span><label><span className="sr-only">추억 검색</span><input type="search" placeholder="제목, 장소, 기록으로 찾기" value={query} onChange={event => setQuery(event.target.value)} /></label></div>}
      <div className="memory-tab-panel" id="memory-content-panel" role="tabpanel" aria-labelledby={`memory-tab-${tab}`}>
        {tab === "map" ? (
          mappedMemories.length ? (
            <div className={styles.mapLayout}><section className="memory-map-list paper-card">
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
                      <button type="button" className="memory-map-open" aria-pressed={mapMemory?.id === item.id} onClick={() => setMapMemoryId(item.id)}>
                        {image ? <img loading="lazy" decoding="async" src={image.url} alt="" /> : <span className="memory-map-letter" />}
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
                <p className="form-hint">위치가 없는 기록은 앨범과 벽면에서 볼 수 있어요.</p>
              )}
            </section>{mapMemory?.coordinates && <aside className={styles.mapPreview}><PlaceLocationMap name={mapMemory.title} coordinates={mapMemory.coordinates} /><div><span className="eyebrow">OUR MOMENT</span><h2>{mapMemory.title}</h2><p>{mapMemory.locationLabel || formatKoDate(mapMemory.happenedOn)}</p><button type="button" className="primary-button" onClick={() => openViewer(mapMemory)}>기록 열기</button><a className="quiet-link" target="_blank" rel="noopener noreferrer" href={`https://map.kakao.com/link/map/${encodeURIComponent(mapMemory.title)},${mapMemory.coordinates[1]},${mapMemory.coordinates[0]}`}>카카오맵에서 위치 보기 ↗</a></div></aside>}</div>
          ) : (
            <div className="empty-soft">
              <h2>{query.trim() ? "검색 조건에 맞는 위치가 없어요" : "지도에 남긴 추억이 아직 없어요"}</h2>
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
          <form ref={composerRef} tabIndex={-1} className="place-create-dialog memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-composer-title" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div>
                <span className="eyebrow">NEW MEMORY · {createStep === "photo" ? "1 / 2" : "2 / 2"}</span>
                <h2 id="memory-composer-title">{createStep === "photo" ? "오늘의 장면을 골라요" : "이 장면에 이름을 붙여요"}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={closeComposer}>×</button>
            </div>
            <div className="memory-step-track" aria-label="기억 만들기 진행 단계"><i className={createStep === "story" ? "is-complete" : ""} /><i /></div>
            {createStep === "photo" ? <Fragment key="photo-step">
              {drafts.length ? (
                <div className="memory-photo-grid" aria-label="선택한 사진">
                  {drafts.map(draft => (
                    <figure className="memory-photo-draft" key={draft.key}>
                      <img loading="lazy" decoding="async" src={draft.preview} alt="" />
                      <button className="memory-photo-draft-remove" type="button" aria-label="사진 빼기" onClick={() => removeDraft(draft.key, "create")}>×</button>
                      {draft.pending && <span className="memory-photo-draft-status">읽는 중</span>}
                    </figure>
                  ))}
                  {drafts.length < MAX_MEMORY_PHOTOS && (
                    <label className="memory-photo-add">
                      <b>+</b>
                      <span>사진 추가</span>
                      <input type="file" accept={MEMORY_PHOTO_ACCEPT} multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addDrafts(files, "create"); }} />
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
                  <input type="file" accept={MEMORY_PHOTO_ACCEPT} multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addDrafts(files, "create"); }} />
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
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions">
                <button className="outline-button" type="button" onClick={closeComposer}>취소</button>
                {!drafts.length && <button className="text-button" type="button" onClick={continueToStory}>사진 없이 기록</button>}
                <button className="primary-button" type="button" onClick={continueToStory} disabled={metadataPending}>{drafts.length ? "이 장면으로 계속" : "다음"}</button>
              </div>
            </Fragment> : <Fragment key="story-step">
              <fieldset className="memory-story-fields" disabled={pending || awaitingCreation}>
              <div className="memory-story-preview is-stack">
                {drafts.length ? drafts.slice(0, 3).map((draft, index) => (
                  <img loading="lazy" decoding="async" src={draft.preview} alt="" key={draft.key} style={{ transform: `rotate(${(index - 1) * 4}deg)` }} />
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
              </fieldset>
              {error && <p className="form-error" role="alert">{error}</p>}
              {awaitingCreation && <p className="memory-privacy-note" role="status">작성한 내용과 사진을 유지했어요. 다시 저장하면 같은 기록의 저장 결과를 확인해요.</p>}
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setCreateStep("photo")} disabled={pending || awaitingCreation}>이전</button><button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending || metadataPending} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{uploadProgress ? `사진 올리는 중 ${uploadProgress.done}/${uploadProgress.total}` : pending ? "추억 저장 중..." : awaitingCreation ? "저장 결과 다시 확인" : "기억으로 남기기"}</button></div>
            </Fragment>}
          </form>
        </div>
      )}
      {viewer && (
        <div className="dialog-backdrop memory-viewer-backdrop" role="presentation" onClick={() => !pending && closeViewer()}>
          <article
            ref={viewerRef}
            tabIndex={-1}
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
                    <button className="memory-viewer-btn memory-viewer-btn--ghost" type="button" disabled={pending} onClick={() => beginEdit(viewer)}>수정</button>
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
                        <MemoryFace memory={viewer} size="hero" skipImage />
                        {coverFailed && <button type="button" className="outline-button" onClick={() => { setPhotoRetry(value => value + 1); setCoverFailed(false); }}>사진 다시 불러오기</button>}
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
                            <img loading="lazy" decoding="async" src={image.url} alt="" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <p className="memory-viewer-meta">
                      {formatKoDate(viewer.happenedOn)}
                      {viewer.locationLabel ? ` · ${viewer.locationLabel}` : ""}
                    </p>
                    <h2 id="memory-viewer-title" tabIndex={-1}>{viewer.title}</h2>
                    <ExpandableText className="memory-viewer-lead" text={viewer.description || "그날의 장면."} lines={5} label="추억 기록" />
                    {activeViewerPhoto ? (
                      <ul className="memory-viewer-facts" aria-label="사진 정보">
                        <li>
                          {activeViewerPhoto.capturedAt
                            ? `촬영 ${new Date(activeViewerPhoto.capturedAt).toLocaleString("ko-KR")}`
                            : "촬영일 정보 없음"}
                        </li>
                        <li>
                          {[activeViewerPhoto.cameraMake, activeViewerPhoto.cameraModel].filter(Boolean).join(" ")
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
                <fieldset className="memory-story-fields" disabled={pending || awaitingEdit}>
                <div className="memory-edit-head">
                  <span className="eyebrow">EDIT MEMORY</span>
                  <h2 id="memory-viewer-title" tabIndex={-1}>이 장면을 다듬어요</h2>
                </div>
                <div className="memory-photo-grid is-edit" aria-label="추억 사진">
                  {memoryImages(viewer).map(image => (
                    <figure className="memory-photo-draft is-saved" key={image.id}>
                      <img loading="lazy" decoding="async" src={image.url} alt="" />
                    </figure>
                  ))}
                  {editDrafts.map(draft => (
                    <figure className="memory-photo-draft" key={draft.key}>
                      <img loading="lazy" decoding="async" src={draft.preview} alt="" />
                      <button className="memory-photo-draft-remove" type="button" aria-label="사진 빼기" onClick={() => removeDraft(draft.key, "edit")}>×</button>
                    </figure>
                  ))}
                  {viewer.photos.length + editDrafts.length < MAX_MEMORY_PHOTOS && (
                    <label className="memory-photo-add">
                      <b>+</b>
                      <span>사진 추가</span>
                      <input type="file" accept={MEMORY_PHOTO_ACCEPT} multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addDrafts(files, "edit"); }} />
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
                </fieldset>
                {error && <p className="form-error" role="alert">{error}</p>}
                {editConflict && <button type="button" className="text-button" onClick={cancelEdit}>입력을 취소하고 최신 기록 보기</button>}
                {awaitingEdit && <p className="memory-privacy-note" role="status">내용과 사진을 유지했어요. 저장 결과를 확인할 때까지 이 화면에서 다시 시도해 주세요. 같은 사진이 중복으로 저장되지 않아요.</p>}
                <div className="dialog-actions"><button className="outline-button" type="button" onClick={cancelEdit} disabled={pending || awaitingEdit}>취소</button><button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending || metadataPending} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{uploadProgress ? `사진 올리는 중 ${uploadProgress.done}/${uploadProgress.total}` : pending ? "변경 저장 중..." : awaitingEdit ? "저장 결과 다시 확인" : "변경 저장"}</button></div>
              </form>
            )}
          </article>
        </div>
      )}
    </>
  );
}
