"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { createMemory, deleteMemory, updateMemory } from "../actions";
import type { Memory, MemoryType, PhotoMetadataInput } from "../types";
import type { Place } from "@/features/places/types/place";
import { formatKoDate, toIsoDate } from "@/lib/dates";

type MemoryTab = "timeline" | "album" | "map" | "trip" | "date";
type CreateStep = "photo" | "story";

const MEMORY_TYPE_LABEL: Record<MemoryType, string> = { free: "그날", trip: "여행", date: "데이트" };
const MEMORY_TABS: ReadonlyArray<{ id: MemoryTab; label: string }> = [
  { id: "timeline", label: "벽면" },
  { id: "album", label: "앨범" },
  { id: "map", label: "지도" },
  { id: "trip", label: "여행" },
  { id: "date", label: "데이트" },
];
const RICH_SLOT_LIMIT = 6;
const CORK_SCRAP_ID = "cork-scrap";
const CORK_DRAG_GAP = 7;
type CorkKind = "hero" | "note" | "scrap" | "rest";
type CorkPos = { x: number; y: number; z: number };

function corkStorageKey(coupleId: string) {
  return `only-us:cork-wall:${coupleId}`;
}
function defaultCorkPos(kind: CorkKind, index = 0): CorkPos {
  if (kind === "hero") return { x: 5, y: 5, z: 2 };
  if (kind === "note") return { x: 61, y: 13, z: 3 };
  if (kind === "scrap") return { x: 44, y: 48, z: 5 };
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 7 + col * 23, y: 66 + row * 24, z: 2 + index };
}
function readCorkPositions(coupleId: string): Record<string, CorkPos> {
  try {
    const raw = localStorage.getItem(corkStorageKey(coupleId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CorkPos>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeCorkPositions(coupleId: string, positions: Record<string, CorkPos>) {
  try {
    localStorage.setItem(corkStorageKey(coupleId), JSON.stringify(positions));
  } catch {
    return;
  }
}

function CorkPiece({
  id,
  kind,
  index = 0,
  className,
  positions,
  setPositions,
  coupleId,
  draggingId,
  setDraggingId,
  onOpen,
  children,
}: {
  id: string;
  kind: CorkKind;
  index?: number;
  className?: string;
  positions: Record<string, CorkPos>;
  setPositions: React.Dispatch<React.SetStateAction<Record<string, CorkPos>>>;
  coupleId: string;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    z: number;
    moved: boolean;
  } | null>(null);
  const pos = positions[id] ?? defaultCorkPos(kind, index);

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const node = nodeRef.current;
    if (!node) return;
    const current = positions[id] ?? defaultCorkPos(kind, index);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: current.x,
      origY: current.y,
      z: Math.max(current.z, 8) + 1,
      moved: false,
    };
    setDraggingId(id);
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* untrusted or synthetic events may not capture */
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const node = nodeRef.current;
    if (!drag || !node || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && (dx * dx + dy * dy) < CORK_DRAG_GAP * CORK_DRAG_GAP) return;
    drag.moved = true;
    event.preventDefault();
    const stage = node.closest(".memory-cork-stage");
    if (!(stage instanceof HTMLElement)) return;
    const box = stage.getBoundingClientRect();
    const piece = node.getBoundingClientRect();
    const maxX = Math.max(0, (1 - piece.width / box.width) * 100);
    const maxY = Math.max(0, (1 - piece.height / box.height) * 100);
    const x = Math.min(maxX, Math.max(0, drag.origX + (dx / box.width) * 100));
    const y = Math.min(maxY, Math.max(0, drag.origY + (dy / box.height) * 100));
    setPositions(current => ({ ...current, [id]: { x, y, z: drag.z } }));
  }

  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const node = nodeRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    if (node?.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      const suppress = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
      };
      node?.addEventListener("click", suppress, { capture: true, once: true });
      setPositions(current => {
        writeCorkPositions(coupleId, current);
        return current;
      });
      return;
    }
    onOpen?.();
  }

  return (
    <div
      ref={nodeRef}
      className={`memory-cork-piece is-${kind} ${className ?? ""} ${draggingId === id ? "is-dragging" : ""}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: draggingId === id ? 80 : pos.z }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={event => {
        if (!onOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
    </div>
  );
}

function MemoryTypeMark({ type, className }: { type: MemoryType; className: string }) {
  if (type === "free") return null;
  return <span className={`${className} is-${type}`}>{MEMORY_TYPE_LABEL[type]}</span>;
}
function isDisplayableUrl(url: string | null | undefined) {
  return Boolean(url && /^(https?:\/\/|blob:|data:image\/)/i.test(url));
}
function hasPhoto(item: Memory) {
  return isDisplayableUrl(item.coverUrl);
}
function monthLabel(iso: string) {
  const [year, month] = iso.split("-");
  if (!year || !month) return iso;
  return `${year}년 ${Number(month)}월`;
}
function scrapQuote(featured: Memory | null, secondary: Memory | null, notes: Memory[]) {
  const used = new Set([secondary?.description?.trim()].filter(Boolean) as string[]);
  return [featured, ...notes]
    .map(item => item?.description?.trim())
    .find(text => text && text.length > 8 && !used.has(text) && text.split("·").length < 3) ?? "";
}

type Fastener = "pin" | "pin-left" | "tape-left" | "tape-right";

function fastenerFor(photo: boolean, index: number): Fastener {
  if (photo) return index % 2 === 0 ? "tape-left" : "tape-right";
  return index % 3 === 1 ? "pin-left" : "pin";
}

function WallFastener({ kind }: { kind: Fastener }) {
  if (kind.startsWith("tape")) return <span className={`memory-tape is-${kind}`} aria-hidden="true" />;
  return <span className={`letter-pin is-${kind}`} aria-hidden="true" />;
}

function groupByMonth(list: Memory[]) {
  const groups: Array<{ label: string; items: Memory[] }> = [];
  list.forEach(item => {
    const label = monthLabel(item.happenedOn);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  });
  return groups;
}
function pickHighlights(list: Memory[]) {
  const photos = list.filter(hasPhoto);
  const notes = list.filter(item => !hasPhoto(item));
  const featured = photos[0] ?? notes[0] ?? null;
  const secondary =
    notes.find(item => item.id !== featured?.id)
    ?? photos.find(item => item.id !== featured?.id)
    ?? null;
  const used = new Set([featured?.id, secondary?.id].filter(Boolean) as string[]);
  const rest = list.filter(item => !used.has(item.id));
  const richRest = rest.slice(0, RICH_SLOT_LIMIT);
  return {
    featured,
    secondary,
    photoRest: richRest.filter(hasPhoto),
    noteRest: richRest.filter(item => !hasPhoto(item)),
    overflowRest: rest.slice(RICH_SLOT_LIMIT),
  };
}

function MemoryFace({ memory, size = "card" }: { memory: Memory; size?: "hero" | "card" | "mini" }) {
  if (isDisplayableUrl(memory.coverUrl)) return <img src={memory.coverUrl ?? ""} alt="" />;
  return (
    <div className={`memory-letter-face is-${memory.memoryType} is-${size}`}>
      <i className="memory-letter-margin" aria-hidden="true" />
      {memory.memoryType !== "free" && <em>{MEMORY_TYPE_LABEL[memory.memoryType]}</em>}
      <b>{memory.title}</b>
      <small>{formatKoDate(memory.happenedOn)}</small>
    </div>
  );
}

function MemoryHero({ memory }: { memory: Memory }) {
  const photo = hasPhoto(memory);
  return (
    <figure className={`memory-cork-hero ${photo ? "has-photo" : "is-letter"}`}>
      <span className="memory-cork-tape is-top" aria-hidden="true" />
      <span className="memory-cork-tape is-bottom" aria-hidden="true" />
      <div className="memory-cork-open">
        {photo ? <img className="memory-cork-photo" src={memory.coverUrl ?? ""} alt="" draggable={false} /> : (
          <span className="memory-cork-letter"><b>{memory.title}</b></span>
        )}
        <span className="memory-cork-caption">
          <small>{formatKoDate(memory.happenedOn)}</small>
          <strong>{memory.title}</strong>
        </span>
      </div>
    </figure>
  );
}

function MemoryLinedNote({ memory }: { memory: Memory }) {
  return (
    <article className="memory-lined-note">
      <WallFastener kind="pin" />
      <div className="memory-note-open">
        <span className={`memory-lined-mark is-${memory.memoryType}`}>{MEMORY_TYPE_LABEL[memory.memoryType]}</span>
        <h3>{memory.title}</h3>
        <time>{formatKoDate(memory.happenedOn)}</time>
        {(memory.description || memory.locationLabel) && <p>{memory.description || memory.locationLabel}</p>}
      </div>
    </article>
  );
}

function MemoryPiece({
  memory,
  size,
  index = 0,
  onOpen,
}: {
  memory: Memory;
  size: "main" | "small" | "mini";
  index?: number;
  onOpen: (memory: Memory) => void;
}) {
  const photo = hasPhoto(memory);
  return (
    <figure className={`memory-polaroid memory-${size} ${photo ? "" : "is-letter"} ${memory.photos.length > 1 ? "has-stack" : ""}`}>
      <WallFastener kind={fastenerFor(photo, size === "small" ? 1 : index)} />
      <button type="button" className="memory-album-open" onClick={() => onOpen(memory)}>
        <span className="memory-polaroid-media">
          <MemoryFace memory={memory} size={size === "main" ? "hero" : size === "mini" ? "mini" : "card"} />
          {photo && <MemoryTypeMark type={memory.memoryType} className={`memory-badge-ribbon ${size === "mini" ? "is-mini" : ""}`} />}
          {memory.photos.length > 1 && <span className="memory-photo-count">{size === "mini" ? `+${memory.photos.length - 1}` : `사진 ${memory.photos.length}장`}</span>}
        </span>
      </button>
      <figcaption>
        <span>{formatKoDate(memory.happenedOn)}{memory.locationLabel && size !== "mini" ? ` · ${memory.locationLabel}` : ""}</span>
        {photo && (size === "main" ? <h2>{memory.title}</h2> : <h3>{memory.title}</h3>)}
      </figcaption>
    </figure>
  );
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
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoMetadata, setPhotoMetadata] = useState<PhotoMetadataInput | null>(null);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [metadataPending, setMetadataPending] = useState(false);
  const [viewer, setViewer] = useState<Memory | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");
  const [editType, setEditType] = useState<MemoryType>("free");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editPreview, setEditPreview] = useState("");
  const [editPhotoMeta, setEditPhotoMeta] = useState<PhotoMetadataInput | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [memoryType, setMemoryType] = useState<MemoryType>("free");
  const coupleKey = session.mode === "authenticated" ? session.coupleId : "guest";
  const [corkPositions, setCorkPositions] = useState<Record<string, CorkPos>>({});
  const [corkDraggingId, setCorkDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setHappenedOn(current => current || toIsoDate(new Date()));
  }, []);

  useEffect(() => () => {
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => () => {
    if (editPreview.startsWith("blob:")) URL.revokeObjectURL(editPreview);
  }, [editPreview]);

  useEffect(() => {
    setCoverFailed(false);
  }, [viewer?.id, viewer?.coverUrl]);

  useEffect(() => {
    setCorkPositions(readCorkPositions(coupleKey));
  }, [coupleKey]);

  async function inspectPhoto(file?: File) {
    setSelectedFile(file ?? null);
    setFileName(file?.name ?? "");
    setPhotoMetadata(null);
    setLatitude("");
    setLongitude("");
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : "");
    if (!file) return;
    setMetadataPending(true);
    try {
      const [{ parse }, bitmap] = await Promise.all([
        import("exifr"),
        createImageBitmap(file).catch(() => null),
      ]);
      const exif = await parse(file, [
        "DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "latitude", "longitude",
        "Make", "Model", "LensModel", "Orientation", "Software",
      ]).catch(() => null) as Record<string, unknown> | null;
      const lat = Number(exif?.latitude ?? exif?.GPSLatitude);
      const lng = Number(exif?.longitude ?? exif?.GPSLongitude);
      const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
      const capturedDate = captured instanceof Date ? captured : captured ? new Date(String(captured)) : null;
      const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCoordinates) {
        setLatitude(lat.toFixed(6));
        setLongitude(lng.toFixed(6));
        setLocationLabel(current => current || "사진의 촬영 위치");
      }
      if (capturedDate && !Number.isNaN(capturedDate.getTime())) setHappenedOn(toIsoDate(capturedDate));
      setPhotoMetadata({
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        width: bitmap?.width ?? null,
        height: bitmap?.height ?? null,
        capturedAt: capturedDate && !Number.isNaN(capturedDate.getTime()) ? capturedDate.toISOString() : null,
        latitude: hasCoordinates ? lat : null,
        longitude: hasCoordinates ? lng : null,
        cameraMake: String(exif?.Make ?? ""),
        cameraModel: String(exif?.Model ?? ""),
        orientation: Number.isFinite(Number(exif?.Orientation)) ? Number(exif?.Orientation) : null,
        locationSource: hasCoordinates ? "exif" : "none",
        metadata: {
          lens: String(exif?.LensModel ?? ""),
          software: String(exif?.Software ?? ""),
        },
      });
      bitmap?.close();
    } catch {
      setPhotoMetadata({ originalFilename: file.name, mimeType: file.type, fileSize: file.size });
    } finally {
      setMetadataPending(false);
    }
  }

  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [places],
  );
  const visible = useMemo(() => {
    if (tab === "trip") return memories.filter(item => item.memoryType === "trip");
    if (tab === "date") return memories.filter(item => item.memoryType === "date");
    return memories;
  }, [memories, tab]);
  const { featured, secondary, photoRest, noteRest, overflowRest } = useMemo(
    () => pickHighlights(visible),
    [visible],
  );
  const quote = scrapQuote(featured, secondary, noteRest);
  const corkPins = [...photoRest, ...noteRest];
  const corkPieceProps = {
    positions: corkPositions,
    setPositions: setCorkPositions,
    coupleId: coupleKey,
    draggingId: corkDraggingId,
    setDraggingId: setCorkDraggingId,
  };

  function openComposer() {
    setCreateStep("photo");
    setError("");
    setOpen(true);
  }

  function continueToStory() {
    setTitle(current => current || (locationLabel && locationLabel !== "사진의 촬영 위치" ? `${locationLabel}에서의 우리` : "우리의 하루"));
    setCreateStep("story");
  }

  function beginEdit(memory: Memory) {
    setEditTitle(memory.title);
    setEditDate(memory.happenedOn);
    setEditDescription(memory.description);
    setEditLocation(memory.locationLabel);
    setEditLongitude(memory.coordinates?.[0]?.toString() ?? "");
    setEditLatitude(memory.coordinates?.[1]?.toString() ?? "");
    setEditType(memory.memoryType);
    if (editPreview.startsWith("blob:")) URL.revokeObjectURL(editPreview);
    setEditFile(null);
    setEditPhotoMeta(null);
    setEditPreview(isDisplayableUrl(memory.coverUrl) ? memory.coverUrl ?? "" : "");
    setError("");
    setEditing(true);
  }

  async function inspectEditPhoto(file?: File) {
    if (editPreview.startsWith("blob:")) URL.revokeObjectURL(editPreview);
    setEditFile(file ?? null);
    setEditPhotoMeta(null);
    setEditPreview(file ? URL.createObjectURL(file) : "");
    if (!file) return;
    try {
      const [{ parse }, bitmap] = await Promise.all([
        import("exifr"),
        createImageBitmap(file).catch(() => null),
      ]);
      const exif = await parse(file, [
        "DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "latitude", "longitude",
        "Make", "Model",
      ]).catch(() => null) as Record<string, unknown> | null;
      const lat = Number(exif?.latitude ?? exif?.GPSLatitude);
      const lng = Number(exif?.longitude ?? exif?.GPSLongitude);
      const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
      const capturedDate = captured instanceof Date ? captured : captured ? new Date(String(captured)) : null;
      const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
      if (hasCoordinates && !editLatitude && !editLongitude) {
        setEditLatitude(lat.toFixed(6));
        setEditLongitude(lng.toFixed(6));
      }
      if (capturedDate && !Number.isNaN(capturedDate.getTime()) && !editDate) setEditDate(toIsoDate(capturedDate));
      setEditPhotoMeta({
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        width: bitmap?.width ?? null,
        height: bitmap?.height ?? null,
        capturedAt: capturedDate && !Number.isNaN(capturedDate.getTime()) ? capturedDate.toISOString() : null,
        latitude: hasCoordinates ? lat : null,
        longitude: hasCoordinates ? lng : null,
        cameraMake: String(exif?.Make ?? ""),
        cameraModel: String(exif?.Model ?? ""),
        locationSource: hasCoordinates ? "exif" : "none",
      });
      bitmap?.close();
    } catch {
      setEditPhotoMeta({ originalFilename: file.name, mimeType: file.type, fileSize: file.size });
    }
  }

  function closeViewer() {
    if (editPreview.startsWith("blob:")) URL.revokeObjectURL(editPreview);
    setEditFile(null);
    setEditPreview("");
    setEditPhotoMeta(null);
    setEditing(false);
    setViewer(null);
  }

  function cancelEdit() {
    if (editPreview.startsWith("blob:")) URL.revokeObjectURL(editPreview);
    setEditFile(null);
    setEditPreview("");
    setEditPhotoMeta(null);
    setEditing(false);
    setError("");
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
    let coverUrl = "";
    let photoMeta = editPhotoMeta;
    const file = editFile;
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setPending(false);
        setError("20MB 이하 이미지만 올릴 수 있어요.");
        return;
      }
      const supabase = createClient();
      if (!supabase) {
        setPending(false);
        setError("저장소를 아직 연결하지 않았어요.");
        return;
      }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${session.coupleId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await supabase.storage.from("memory-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        setPending(false);
        setError(uploaded.error.message);
        return;
      }
      coverUrl = path;
      photoMeta = { ...photoMeta, storagePath: path };
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
      coverUrl: coverUrl || undefined,
      photo: coverUrl ? photoMeta ?? undefined : undefined,
    });
    if ("error" in result) {
      if (coverUrl && session.mode === "authenticated") {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove([coverUrl]);
      }
      setPending(false);
      setError(result.error);
      return;
    }
    setMemories(current => current.map(memory => memory.id === result.memory.id ? result.memory : memory));
    setViewer(result.memory);
    if (editPreview.startsWith("blob:")) URL.revokeObjectURL(editPreview);
    setEditFile(null);
    setEditPreview("");
    setEditPhotoMeta(null);
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
    let photoUrl = coverUrl || selected?.image || "";
    let uploadedPath: string | null = null;
    const file = selectedFile;
    if (file) {
      if (session.mode !== "authenticated") {
        setPending(false);
        setError("로그인 후 사진을 올릴 수 있어요.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setPending(false);
        setError("20MB 이하 이미지만 올릴 수 있어요.");
        return;
      }
      const supabase = createClient();
      if (!supabase) {
        setPending(false);
        setError("저장소를 아직 연결하지 않았어요.");
        return;
      }
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${session.coupleId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await supabase.storage.from("memory-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        setPending(false);
        setError(uploaded.error.message);
        return;
      }
      uploadedPath = path;
      photoUrl = path;
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
      coverUrl: photoUrl,
      lng: selected?.coordinates?.[0] ?? (hasManualCoordinates ? parsedLng : null),
      lat: selected?.coordinates?.[1] ?? (hasManualCoordinates ? parsedLat : null),
      memoryType,
      photo: file ? {
        ...photoMetadata,
        storagePath: uploadedPath,
        latitude: selected?.coordinates?.[1] ?? (hasManualCoordinates ? parsedLat : photoMetadata?.latitude ?? null),
        longitude: selected?.coordinates?.[0] ?? (hasManualCoordinates ? parsedLng : photoMetadata?.longitude ?? null),
        locationSource: selected ? "place" : hasManualCoordinates
          ? photoMetadata?.locationSource === "exif" ? "exif" : "manual"
          : "none",
      } : undefined,
    });
    setPending(false);
    if ("error" in result) {
      if (uploadedPath && session.mode === "authenticated") {
        const supabase = createClient();
        await supabase?.storage.from("memory-photos").remove([uploadedPath]);
      }
      setError(result.error);
      return;
    }
    setMemories(prev => [result.memory, ...prev]);
    setOpen(false);
    setTitle("");
    setDescription("");
    setLocationLabel("");
    setPlaceId("");
    setCoverUrl("");
    setFileName("");
    setSelectedFile(null);
    setPhotoPreview("");
    setPhotoMetadata(null);
    setLatitude("");
    setLongitude("");
  }

  function renderList(list: Memory[]) {
    if (!list.length) {
      return (
        <div className="empty-soft">
          <h1>이 보기에 추억이 없어요</h1>
          <p>남긴 장면이 있으면 벽면과 앨범에서 다시 볼 수 있어요.</p>
          <button className="primary-button" type="button" onClick={openComposer}>추억 남기기</button>
        </div>
      );
    }
    if (tab === "album") {
      return (
        <ul className="memory-album">
          {list.map((item, index) => (
            <li key={item.id} className={hasPhoto(item) ? "" : "is-letter"} style={{ animationDelay: `${Math.min(index, 11) * 45}ms` }}>
              <WallFastener kind={fastenerFor(hasPhoto(item), index)} />
              <button type="button" className="memory-album-open" onClick={() => setViewer(item)}>
                <span className="memory-polaroid-media">
                  <MemoryFace memory={item} size="card" />
                  {hasPhoto(item) && <MemoryTypeMark type={item.memoryType} className="memory-badge-ribbon" />}
                  {item.photos.length > 1 && <span className="memory-photo-count">+{item.photos.length - 1}</span>}
                </span>
                <b>{item.title}</b>
                <small>{formatKoDate(item.happenedOn)}</small>
              </button>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="memory-wall">
        <p className="memory-cork-hint">종이를 잡아 옮길 수 있어요. 가볍게 누르면 열립니다.</p>
        <div className={`memory-cork-stage ${corkDraggingId ? "is-dragging" : ""}`}>
          {featured && (
            <CorkPiece id={featured.id} kind="hero" onOpen={() => setViewer(featured)} {...corkPieceProps}>
              <MemoryHero memory={featured} />
            </CorkPiece>
          )}
          {secondary && (
            <CorkPiece id={secondary.id} kind="note" onOpen={() => setViewer(secondary)} {...corkPieceProps}>
              <MemoryLinedNote memory={secondary} />
            </CorkPiece>
          )}
          {quote && (
            <CorkPiece id={CORK_SCRAP_ID} kind="scrap" {...corkPieceProps}>
              <aside className="memory-scrap">
                <WallFastener kind="pin-left" />
                <p>{quote}</p>
              </aside>
            </CorkPiece>
          )}
          {corkPins.map((item, index) => (
            <CorkPiece id={item.id} kind="rest" index={index} key={item.id} onOpen={() => setViewer(item)} {...corkPieceProps}>
              {hasPhoto(item) ? (
                <figure className={`memory-polaroid memory-mini ${item.photos.length > 1 ? "has-stack" : ""}`}>
                  <WallFastener kind={fastenerFor(true, index)} />
                  <div className="memory-album-open">
                    <span className="memory-polaroid-media">
                      <MemoryFace memory={item} size="mini" />
                      <MemoryTypeMark type={item.memoryType} className="memory-badge-ribbon is-mini" />
                      {item.photos.length > 1 && <span className="memory-photo-count">{`+${item.photos.length - 1}`}</span>}
                    </span>
                  </div>
                  <figcaption>
                    <span>{formatKoDate(item.happenedOn)}</span>
                    <h3>{item.title}</h3>
                  </figcaption>
                </figure>
              ) : (
                <article className={`memory-note-card is-${fastenerFor(false, index)}`}>
                  <WallFastener kind={fastenerFor(false, index)} />
                  <div className="memory-note-open">
                    <div className="memory-note-eyebrow">
                      <span>{formatKoDate(item.happenedOn)}</span>
                      <MemoryTypeMark type={item.memoryType} className="memory-list-badge" />
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.description || item.locationLabel || "사진 없이, 마음으로만 남겨둔 하루."}</p>
                  </div>
                </article>
              )}
            </CorkPiece>
          ))}
          <i className="memory-wall-spark" aria-hidden="true" />
        </div>
        {overflowRest.length > 0 && (
          <div className="memory-rest-section">
            {groupByMonth(overflowRest).map(group => (
              <div className="memory-month-block" key={group.label}>
                <div className="memory-rest-heading"><span>{group.label}</span><i aria-hidden="true" /></div>
                <ul className="memory-list">
                  {group.items.map((item, index) => (
                    <li key={item.id} style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
                      <button type="button" className="memory-list-open" onClick={() => setViewer(item)}>
                        <span>{formatKoDate(item.happenedOn)}</span>
                        <b>{item.title}</b>
                        <small>{item.locationLabel || item.description || "우리의 기록"}</small>
                        <MemoryTypeMark type={item.memoryType} className="memory-list-badge" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="page-title-row memory-page-header">
        <div>
          <span className="eyebrow">OUR ARCHIVE · {new Date().getFullYear()}</span>
          <h1>함께여서 기억나는 장면들</h1>
          <p>편지에 끼워 둔 사진처럼, 그날의 마음을 천천히 모아 두었어요.</p>
        </div>
      </div>
      <div className="page-actions date-planner-actions trip-planner-actions memory-page-actions">
        <div className="memory-tabs" role="tablist" aria-label="추억 보기">
          {MEMORY_TABS.map(item => (
            <button className={`date-action-button ${tab === item.id ? "is-active" : ""}`} type="button" key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
        </div>
        <div className="date-action-group">
          <button className="date-action-button is-primary" type="button" onClick={openComposer}><HeaderActionIcon name="plus" /><span>추억 남기기</span></button>
        </div>
      </div>

      <div key={tab} className="memory-tab-panel">
        {tab === "map" ? (
          visible.filter(item => item.coordinates).length ? (
            <section className="memory-map-list paper-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">ON THE MAP</span>
                  <h2>좌표가 있는 추억</h2>
                </div>
                <Link className="quiet-link" href="/our-map">Our Map 열기 →</Link>
              </div>
              <ul>
                {visible.filter(item => item.coordinates).map(item => (
                  <li key={item.id}>
                    <Link href="/our-map">
                      <b>{item.title}</b>
                      <small>{formatKoDate(item.happenedOn)}{item.locationLabel ? ` · ${item.locationLabel}` : ""}</small>
                    </Link>
                  </li>
                ))}
              </ul>
              {visible.some(item => !item.coordinates) && (
                <p className="form-hint">좌표가 없는 기록은 타임라인에서만 보여요. 장소를 연결하면 지도에도 올라갑니다.</p>
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
        ) : !memories.length ? (
          <div className="empty-soft">
            <h1>아직 남긴 추억이 없어요</h1>
            <p>다녀온 장소를 고르거나, 그날의 장면을 직접 적어 보세요.</p>
            <button className="primary-button" type="button" onClick={openComposer}>첫 추억 남기기</button>
          </div>
        ) : renderList(visible)}
      </div>

      {open && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !pending && setOpen(false)}>
          <form className="place-create-dialog memory-dialog" onClick={event => event.stopPropagation()} onSubmit={event => void submit(event)}>
            <div className="dialog-head">
              <div>
                <span className="eyebrow">NEW MEMORY · {createStep === "photo" ? "1 / 2" : "2 / 2"}</span>
                <h2>{createStep === "photo" ? "먼저, 오늘의 장면을 골라요" : "이 장면에 이름을 붙여요"}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="memory-step-track" aria-label="기억 만들기 진행 단계"><i className={createStep === "story" ? "is-complete" : ""} /><i /></div>
            {createStep === "photo" ? <>
              <label className={`memory-photo-drop ${photoPreview ? "has-photo" : ""}`}>
                {photoPreview ? <img src={photoPreview} alt="선택한 장면" /> : <div><b>사진을 선택하세요</b><span>촬영 날짜와 위치를 자동으로 정리해드려요</span><small>JPG · PNG · WEBP · HEIC, 최대 20MB</small></div>}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" onChange={event => void inspectPhoto(event.target.files?.[0])} />
              </label>
              {photoPreview && <div className="photo-analysis-result"><div><span className={metadataPending ? "is-reading" : ""}>{metadataPending ? "분석 중" : "분석 완료"}</span><b>{fileName}</b></div><ul><li><span>촬영일</span><b>{photoMetadata?.capturedAt ? new Date(photoMetadata.capturedAt).toLocaleString("ko-KR") : "정보 없음 · 다음 단계에서 입력"}</b></li><li><span>위치</span><b>{photoMetadata?.locationSource === "exif" ? `${latitude}, ${longitude}` : "GPS 없음 · 다음 단계에서 연결"}</b></li><li><span>카메라</span><b>{[photoMetadata?.cameraMake, photoMetadata?.cameraModel].filter(Boolean).join(" ") || "정보 없음"}</b></li></ul></div>}
              <p className="memory-privacy-note">원본 사진은 우리만 접근할 수 있는 비공개 보관함에 저장됩니다.</p>
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setOpen(false)}>취소</button><button className="text-button" type="button" onClick={continueToStory}>사진 없이 기록</button><button className="primary-button" type="button" onClick={continueToStory} disabled={metadataPending}>{photoPreview ? "이 장면으로 계속" : "다음"}</button></div>
            </> : <>
              <div className="memory-story-preview">{photoPreview ? <img src={photoPreview} alt="기억 대표 사진" /> : <div>NO PHOTO</div>}<button type="button" onClick={() => setCreateStep("photo")}>사진 변경</button></div>
              <label className="field memory-title-field"><span>이 기억의 제목</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="계획 없이 걷던 토요일" required autoFocus /></label>
              <label className="field"><span>한 줄 기록 <small>선택</small></span><textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="그날 가장 오래 기억하고 싶은 순간은?" rows={3} /></label>
              <div className="memory-fact-grid"><label className="field"><span>날짜</span><input type="date" value={happenedOn} onChange={event => setHappenedOn(event.target.value)} required /></label><label className="field"><span>기억 종류</span><select value={memoryType} onChange={event => setMemoryType(event.target.value as MemoryType)}><option value="free">그날의 기록</option><option value="trip">여행</option><option value="date">데이트</option></select></label></div>
              <label className="field"><span>연결된 장소 <small>선택</small></span><select value={placeId} onChange={event => setPlaceId(event.target.value)}><option value="">직접 적기</option>{sortedPlaces.map(place => <option key={place.id} value={place.id}>{place.name} · {place.district}</option>)}</select></label>
              <label className="field"><span>장소 이름</span><input value={locationLabel} onChange={event => setLocationLabel(event.target.value)} placeholder="성수 · 카페 골목" /></label>
              <details className="memory-location-details"><summary>지도 위치 세밀하게 조정</summary><div className="coordinate-fields"><label className="field"><span>위도</span><input inputMode="decimal" value={latitude} onChange={event => { setLatitude(event.target.value); setPhotoMetadata(current => current ? { ...current, locationSource: "manual" } : current); }} /></label><label className="field"><span>경도</span><input inputMode="decimal" value={longitude} onChange={event => { setLongitude(event.target.value); setPhotoMetadata(current => current ? { ...current, locationSource: "manual" } : current); }} /></label></div></details>
              {!selectedFile && <label className="field"><span>사진 URL <small>선택</small></span><input value={coverUrl} onChange={event => setCoverUrl(event.target.value)} placeholder="https://..." /></label>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions"><button className="outline-button" type="button" onClick={() => setCreateStep("photo")} disabled={pending}>이전</button><button className="primary-button" type="submit" disabled={pending}>{pending ? "우리의보관함에 저장 중..." : "기억으로 남기기"}</button></div>
            </>}
          </form>
        </div>
      )}
      {viewer && (
        <div className="dialog-backdrop" role="presentation" onClick={() => !pending && closeViewer()}>
          <article className={`memory-viewer ${!editing && isDisplayableUrl(viewer.coverUrl) && !coverFailed ? "" : "is-letter"} ${editing ? "is-editing" : ""}`} onClick={event => event.stopPropagation()}>
            {!editing && (
              <div className="memory-viewer-media">
                {isDisplayableUrl(viewer.coverUrl) && !coverFailed ? (
                  <img src={viewer.coverUrl ?? ""} alt="" onError={() => setCoverFailed(true)} />
                ) : (
                  <MemoryFace memory={viewer} size="hero" />
                )}
                {isDisplayableUrl(viewer.coverUrl) && !coverFailed && <MemoryTypeMark type={viewer.memoryType} className="memory-badge-ribbon" />}
                {viewer.photos.length > 1 && <span className="memory-photo-count">사진 {viewer.photos.length}장</span>}
              </div>
            )}
            {!editing ? <div>
              <span>{formatKoDate(viewer.happenedOn)}{viewer.locationLabel ? ` · ${viewer.locationLabel}` : ""}</span>
              <h2>{viewer.title}</h2>
              <p>{viewer.description || "그날의 장면."}</p>
              {viewer.photos[0] && <div className="memory-photo-facts"><span>{viewer.photos[0].capturedAt ? `촬영 ${new Date(viewer.photos[0].capturedAt).toLocaleString("ko-KR")}` : "촬영일 정보 없음"}</span><span>{[viewer.photos[0].cameraMake, viewer.photos[0].cameraModel].filter(Boolean).join(" ") || "카메라 정보 없음"}</span>{viewer.coordinates && <Link href="/our-map">지도에서 보기 →</Link>}</div>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="dialog-actions memory-viewer-actions"><button className="danger-button" type="button" disabled={pending} onClick={() => void removeCurrentMemory()}>삭제</button><button className="outline-button" type="button" onClick={() => beginEdit(viewer)}>수정</button><button className="primary-button" type="button" onClick={closeViewer}>닫기</button></div>
            </div> : (
              <form className="memory-edit-form" onSubmit={event => void saveEdit(event)}>
                <div className="memory-edit-head">
                  <span className="eyebrow">EDIT MEMORY</span>
                  <h2>이 장면을 다듬어요</h2>
                </div>
                <label className={`memory-edit-photo ${editPreview ? "has-photo" : ""}`}>
                  {editPreview ? <img src={editPreview} alt="추억 사진" /> : (
                    <div>
                      <b>사진을 붙여 꾸며요</b>
                      <span>폴라로이드처럼 벽에 걸릴 장면을 고르세요</span>
                      <small>JPG · PNG · WEBP · HEIC, 최대 20MB</small>
                    </div>
                  )}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" onChange={event => void inspectEditPhoto(event.target.files?.[0])} />
                  {editPreview && <span className="memory-edit-photo-action">{editFile ? "이 사진으로 바꿀게요" : "사진 바꾸기"}</span>}
                </label>
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
                <div className="dialog-actions"><button className="outline-button" type="button" onClick={cancelEdit} disabled={pending}>취소</button><button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "변경 저장"}</button></div>
              </form>
            )}
          </article>
        </div>
      )}
    </>
  );
}
