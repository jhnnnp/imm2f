"use server";

import { revalidatePath } from "next/cache";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/activityServer";
import { isIsoDate, seoulTodayIso } from "@/lib/dates";
import { withWorkspaceRead } from "@/lib/supabase/readContext";
import { listPlaces } from "@/features/places/actions";
import { asPlanCoordinates } from "@/features/planning/planCoordinates";
import type { Json } from "@/lib/supabase/database.types";
import type { CreateMemoryInput, Memory, MemoryPhoto, MemoryType, UpdateMemoryInput } from "./types";

type MemoryRow = {
  id: string;
  memory_type: MemoryType;
  place_id: string | null;
  title: string;
  happened_on: string;
  description: string;
  location_label: string;
  lng: number | null;
  lat: number | null;
  created_by: string | null;
  created_at: string;
};

type PhotoRow = {
  id: string;
  memory_id: string;
  storage_url: string;
  caption: string;
  sort_order: number;
  latitude: number | null;
  longitude: number | null;
  captured_at: string | null;
  storage_path: string | null;
  original_filename: string;
  mime_type: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  camera_make: string;
  camera_model: string;
  location_source: "none" | "exif" | "place" | "manual";
};

const PHOTO_FIELDS = "id, memory_id, storage_url, caption, sort_order, latitude, longitude, captured_at, storage_path, original_filename, mime_type, file_size, width, height, camera_make, camera_model, location_source";

function refreshMemories() {
  revalidatePath("/");
  revalidatePath("/memories");
  revalidatePath("/calendar");
  revalidatePath("/date");
  revalidatePath("/trip");
  revalidatePath("/our-map");
}

function validPhotoPaths(input: CreateMemoryInput | UpdateMemoryInput, coupleId: string) {
  const photos = input.photos?.length ? input.photos : input.photo ? [input.photo] : [];
  return photos.length <= 12 && photos.every(photo => photo && (!photo.storagePath || (typeof photo.storagePath === "string" && photo.storagePath.startsWith(`${coupleId}/`) && !photo.storagePath.split("/").includes(".."))));
}

async function signPhotos(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, photos: Array<{ id: string; storage_path: string | null }>) {
  const paths = [...new Set(photos.flatMap(photo => photo.storage_path ? [photo.storage_path] : []))];
  if (!paths.length) return new Map<string, string>();
  const { data, error } = await supabase.storage.from("memory-photos").createSignedUrls(paths, 60 * 60);
  if (error) throw new Error("사진을 불러오지 못했어요. 다시 시도해 주세요.");
  const urls = new Map((data ?? []).flatMap(item => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
  return new Map(photos.flatMap(photo => {
    const url = photo.storage_path ? urls.get(photo.storage_path) : null;
    return url ? [[photo.id, url] as const] : [];
  }));
}

function isPublicPhotoUrl(value: string | null | undefined) {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function toPhoto(row: PhotoRow, signedUrl?: string): MemoryPhoto {
  const publicUrl = isPublicPhotoUrl(row.storage_url) ? row.storage_url : "";
  return {
    id: row.id,
    storageUrl: signedUrl || publicUrl,
    storagePath: row.storage_path,
    caption: row.caption,
    sortOrder: row.sort_order,
    latitude: row.latitude,
    longitude: row.longitude,
    capturedAt: row.captured_at,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    cameraMake: row.camera_make,
    cameraModel: row.camera_model,
    locationSource: row.location_source,
  };
}

function toMemory(row: MemoryRow, photos: PhotoRow[], signedUrls = new Map<string, string>()): Memory {
  const mapped = photos
    .filter(photo => photo.memory_id === row.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(photo => toPhoto(photo, signedUrls.get(photo.id)));
  const coords = asPlanCoordinates(row.lng, row.lat);
  return {
    id: row.id,
    memoryType: row.memory_type,
    placeId: row.place_id,
    title: row.title,
    happenedOn: row.happened_on,
    description: row.description,
    locationLabel: row.location_label,
    coordinates: coords,
    createdBy: row.created_by,
    createdAt: row.created_at,
    coverUrl: mapped[0]?.storageUrl ?? null,
    photos: mapped,
  };
}

function coverPhotos(photoRows: PhotoRow[]) {
  const first = new Map<string, PhotoRow>();
  for (const photo of [...photoRows].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!first.has(photo.memory_id)) first.set(photo.memory_id, photo);
  }
  return [...first.values()];
}

const loadMemories = cache(async (photoMode: "all" | "cover" | "none"): Promise<{ persist: boolean; memories: Memory[] }> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, memories: [] };
  const supabase = await createClient();
  if (!supabase) return { persist: false, memories: [] };

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("couple_id", session.coupleId)
    .order("happened_on", { ascending: false });
  if (error) throw new Error("추억을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!data) return { persist: true, memories: [] };

  const ids = data.map(row => row.id);
  const { data: photos, error: photoError } = ids.length && photoMode !== "none"
    ? await supabase.from("memory_photos").select(PHOTO_FIELDS).in("memory_id", ids)
    : { data: [] as PhotoRow[], error: null };
  if (photoError) throw new Error("추억 사진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");

  const photoRows = (photos ?? []) as PhotoRow[];
  const mappedPhotos = photoMode === "cover" ? coverPhotos(photoRows) : photoRows;

  return {
    persist: true,
    memories: (data as MemoryRow[]).map(row => toMemory(row, mappedPhotos)),
  };
});

export async function signMemoryPhotoUrls(photoIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(photoIds.filter(Boolean))].slice(0, 48);
  if (!unique.length) return {};
  const session = await getAppSession();
  if (session.mode !== "authenticated") return {};
  const supabase = await createClient();
  if (!supabase) return {};

  const { data: photos, error: photoReadError } = await supabase
    .from("memory_photos")
    .select("id, storage_path, memory_id")
    .in("id", unique);
  if (photoReadError) throw new Error("사진을 확인하지 못했어요. 다시 시도해 주세요.");
  if (!photos?.length) return {};

  const memoryIds = [...new Set(photos.map(row => row.memory_id))];
  const { data: memories, error: memoryReadError } = await supabase
    .from("memories")
    .select("id")
    .eq("couple_id", session.coupleId)
    .in("id", memoryIds);
  if (memoryReadError) throw new Error("사진이 연결된 추억을 확인하지 못했어요.");
  const allowed = new Set((memories ?? []).map(row => row.id));
  const signed = await signPhotos(supabase, photos.filter(row => allowed.has(row.memory_id)));
  return Object.fromEntries(signed);
}

export async function listMemories(options?: { photos?: "all" | "cover" | "none" }) {
  return loadMemories(options?.photos ?? "all");
}

export async function readMemoryWorkspace() {
  return withWorkspaceRead(async () => {
    const [memories, places] = await Promise.all([listMemories(), listPlaces()]);
    return { memories: memories.memories, places: places.places };
  });
}

export const listMemoryCalendarMarks = cache(async (): Promise<Array<{ id: string; title: string; happenedOn: string }>> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("memories")
    .select("id, title, happened_on")
    .eq("couple_id", session.coupleId)
    .order("happened_on", { ascending: false });
  if (error) throw new Error("캘린더의 추억을 불러오지 못했어요. 다시 시도해 주세요.");
  return (data ?? []).map(row => ({
    id: row.id,
    title: row.title,
    happenedOn: row.happened_on,
  }));
});

export async function createMemory(input: CreateMemoryInput): Promise<{ memory: Memory } | { error: string; keepUploadedPhotos?: boolean; conflict?: boolean }> {
  if (!input || typeof input.title !== "string" || typeof input.description !== "string" || typeof input.locationLabel !== "string") return { error: "추억 내용을 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 추억을 남길 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  if (!validPhotoPaths(input, session.coupleId)) return { error: "사진 파일을 확인해 주세요." };
  if (typeof input.attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)) return { error: "저장 요청을 확인하지 못했어요. 입력 화면을 다시 열어 주세요." };
  const title = input.title.trim();
  if (!title || title.length > 500) return { error: "추억 제목을 500자 이내로 입력해 주세요." };
  const happenedOn = input.happenedOn || seoulTodayIso();
  if (!isIsoDate(happenedOn)) return { error: "추억 날짜를 확인해 주세요." };
  if (input.description.length > 20000 || input.locationLabel.length > 1000) return { error: "추억 설명 또는 장소 이름이 너무 길어요." };
  if (input.memoryType !== undefined && !["free", "trip", "date"].includes(input.memoryType)) return { error: "기억 종류를 확인해 주세요." };

  const coords = asPlanCoordinates(input.lng, input.lat);
  if ((input.lng != null || input.lat != null) && !coords) return { error: "추억의 위도와 경도를 확인해 주세요." };
  let lng = coords?.[0] ?? null;
  let lat = coords?.[1] ?? null;
  let locationLabel = input.locationLabel.trim();
  const placeId = input.placeId || null;
  let coverUrl = input.coverUrl?.trim() || "";
  if (placeId) {
    const { data: place, error: placeError } = await supabase.from("places")
      .select("id, name, district, lng, lat, image").eq("id", placeId).eq("couple_id", session.coupleId).maybeSingle();
    if (placeError) return { error: "연결할 장소를 확인하지 못했어요. 다시 시도해 주세요." };
    if (!place) return { error: "연결할 장소가 변경됐어요. 장소를 다시 선택해 주세요." };
    if (!locationLabel) locationLabel = place.district || place.name;
    const placeCoords = asPlanCoordinates(place.lng, place.lat);
    if (!coords && placeCoords) [lng, lat] = placeCoords;
    if (!coverUrl && place.image) coverUrl = place.image;
  }
  const photoInputs = input.photos?.length ? input.photos : input.photo ? [input.photo] : coverUrl ? [{}] : [];
  const photos = photoInputs.map(photo => ({
    storage_url: photo.storagePath || coverUrl,
    storage_path: photo.storagePath ?? null,
    latitude: photo.latitude ?? lat,
    longitude: photo.longitude ?? lng,
    captured_at: photo.capturedAt ?? null,
    original_filename: photo.originalFilename ?? "",
    mime_type: photo.mimeType ?? "",
    file_size: photo.fileSize ?? null,
    width: photo.width ?? null,
    height: photo.height ?? null,
    camera_make: photo.cameraMake ?? "",
    camera_model: photo.cameraModel ?? "",
    orientation: photo.orientation ?? null,
    location_source: photo.locationSource ?? (placeId ? "place" : "none"),
    metadata: photo.metadata ?? {},
  }));
  // The RPC keeps photos and the creation event in the same transaction. Never
  // fall back to two inserts: the same UUID may already have committed remotely.
  let saved;
  try {
    saved = await supabase.rpc("create_memory_atomic", {
      target_id: input.attemptId,
      target_couple: session.coupleId,
      target_memory: { title, happened_on: happenedOn, description: input.description.trim(), location_label: locationLabel,
        memory_type: input.memoryType ?? "free", place_id: placeId, lng, lat },
      target_photos: photos as Json,
    });
  } catch {
    return { error: "저장 응답을 받지 못했어요. 같은 내용으로 다시 시도하면 저장 결과를 확인해요.", keepUploadedPhotos: true };
  }
  if (saved.error || !saved.data || typeof saved.data !== "object" || Array.isArray(saved.data)) {
    if (saved.error && ["22023", "22P02", "22007", "22008", "42501", "23503", "23505", "23514", "PGRST202"].includes(saved.error.code)) {
      return { error: "추억 내용을 저장하지 못했어요. 사진, 날짜와 연결된 장소를 확인해 주세요." };
    }
    return { error: "추억 저장 결과를 확인하지 못했어요. 작성한 내용과 사진은 유지했으니 다시 시도해 주세요.", keepUploadedPhotos: true };
  }
  const result = saved.data as { memory?: MemoryRow; photos?: PhotoRow[] };
  if (!result.memory || result.memory.id !== input.attemptId || !Array.isArray(result.photos)) {
    return { error: "저장 응답을 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요.", keepUploadedPhotos: true };
  }
  const signed = await signPhotos(supabase, result.photos).catch(() => new Map<string, string>());
  const memory = toMemory(result.memory, result.photos, signed);
  refreshMemories();
  return { memory };
}

export async function updateMemory(input: UpdateMemoryInput): Promise<{ memory: Memory } | { error: string; keepUploadedPhotos?: boolean; conflict?: boolean }> {
  if (!input || typeof input.id !== "string" || typeof input.title !== "string"
    || typeof input.description !== "string" || typeof input.locationLabel !== "string"
    || (input.photos !== undefined && !Array.isArray(input.photos))) return { error: "추억 내용을 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  if (!validPhotoPaths(input, session.coupleId)) return { error: "사진 파일을 확인해 주세요." };
  if (typeof input.attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)) return { error: "저장 요청을 확인하지 못했어요. 입력 화면을 다시 열어 주세요." };
  let expected: Json;
  try {
    if (typeof input.expectedSnapshot !== "string" || input.expectedSnapshot.length > 200000) throw new Error("missing snapshot");
    expected = JSON.parse(input.expectedSnapshot) as Json;
    if (!Array.isArray(expected) || expected.length !== 6) throw new Error("invalid snapshot");
  } catch { return { error: "편집을 시작한 기록을 확인하지 못했어요. 최신 기록을 다시 열어 주세요." }; }
  const title = input.title.trim();
  if (!title || title.length > 500) return { error: "추억 제목을 500자 이내로 입력해 주세요." };
  if (!isIsoDate(input.happenedOn)) return { error: "추억 날짜를 확인해 주세요." };
  if (input.description.length > 20000 || input.locationLabel.length > 1000) return { error: "추억 설명 또는 장소 이름이 너무 길어요." };
  if (!["free", "trip", "date"].includes(input.memoryType)) return { error: "기억 종류를 확인해 주세요." };
  const coords = asPlanCoordinates(input.lng, input.lat);
  if ((input.lng != null || input.lat != null) && !coords) return { error: "추억의 위도와 경도를 확인해 주세요." };
  if (input.coverUrl !== undefined && typeof input.coverUrl !== "string") return { error: "사진 주소를 확인해 주세요." };
  const incomingPhotos = input.photos?.length ? input.photos : input.coverUrl?.trim() ? [{ ...input.photo, storagePath: input.photo?.storagePath ?? null }] : [];
  const photos = incomingPhotos.map(photo => ({
    storage_url: photo.storagePath || input.coverUrl?.trim() || "",
    storage_path: photo.storagePath ?? null,
    latitude: photo.latitude ?? coords?.[1] ?? null,
    longitude: photo.longitude ?? coords?.[0] ?? null,
    captured_at: photo.capturedAt ?? null,
    original_filename: photo.originalFilename ?? "",
    mime_type: photo.mimeType ?? "",
    file_size: photo.fileSize ?? null,
    width: photo.width ?? null,
    height: photo.height ?? null,
    camera_make: photo.cameraMake ?? "",
    camera_model: photo.cameraModel ?? "",
    orientation: photo.orientation ?? null,
    location_source: photo.locationSource ?? (coords ? "manual" : "none"),
    metadata: photo.metadata ?? {},
  }));
  // Metadata, new photos, partner event and attempt receipt commit together.
  // In particular, a photo-only retry cannot append the same upload twice.
  let saved;
  try {
    saved = await supabase.rpc("update_memory_atomic", {
      target_attempt: input.attemptId,
      target_id: input.id,
      target_couple: session.coupleId,
      target_expected: expected,
      target_memory: { title, happened_on: input.happenedOn, description: input.description.trim(),
        location_label: input.locationLabel.trim(), memory_type: input.memoryType,
        lng: coords?.[0] ?? null, lat: coords?.[1] ?? null },
      target_photos: photos as Json,
    });
  } catch {
    return { error: "저장 응답을 받지 못했어요. 같은 내용으로 다시 시도하면 수정 결과를 확인해요.", keepUploadedPhotos: true };
  }
  if (saved.error || !saved.data || typeof saved.data !== "object" || Array.isArray(saved.data)) {
    if (saved.error?.code === "P0001" && saved.error.message === "Memory edit conflict") return {
      error: "파트너가 이 추억을 수정했어요. 최신 기록을 확인하고 다시 저장해 주세요.", conflict: true,
    };
    if (saved.error?.code === "P0002") return { error: "이 추억이 삭제됐어요. 최신 기록을 확인해 주세요.", conflict: true };
    if (saved.error && ["22023", "22P02", "22007", "22008", "42501", "23503", "23505", "23514", "PGRST202"].includes(saved.error.code)) {
      return { error: "추억 내용을 저장하지 못했어요. 사진, 날짜와 저장 요청을 확인해 주세요." };
    }
    return { error: "수정 결과를 확인하지 못했어요. 작성한 내용과 사진을 유지했으니 다시 시도해 주세요.", keepUploadedPhotos: true };
  }
  const result = saved.data as { memory?: MemoryRow; photos?: PhotoRow[] };
  if (!result.memory || result.memory.id !== input.id || !Array.isArray(result.photos)
    || result.photos.some(photo => !photo || photo.memory_id !== input.id)) {
    return { error: "수정 응답을 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요.", keepUploadedPhotos: true };
  }
  const signed = await signPhotos(supabase, result.photos).catch(() => new Map<string, string>());
  const memory = toMemory(result.memory, result.photos, signed);
  refreshMemories();
  return { memory };
}

export async function deleteMemory(memoryId: string): Promise<{ ok: true } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data: memory, error: loadError } = await supabase.from("memories").select("id, title").eq("id", memoryId).eq("couple_id", session.coupleId).maybeSingle();
  if (loadError) return { error: "추억을 확인하지 못했어요. 다시 시도해 주세요." };
  if (!memory) { refreshMemories(); return { ok: true }; }
  const { data: photos, error: photoError } = await supabase.from("memory_photos").select("storage_path").eq("memory_id", memoryId);
  if (photoError) return { error: "추억 사진을 확인하지 못했어요. 다시 시도해 주세요." };
  const paths = (photos ?? []).map(photo => photo.storage_path).filter((path): path is string => Boolean(path));
  const { data: deleted, error } = await supabase.from("memories").delete().eq("id", memoryId).eq("couple_id", session.coupleId).select("id").maybeSingle();
  if (error) return { error: "추억을 삭제하지 못했어요. 다시 시도해 주세요." };
  if (!deleted) { refreshMemories(); return { ok: true }; }
  if (paths.length) await supabase.storage.from("memory-photos").remove(paths).catch(() => undefined);
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "memory",
    entityId: memoryId,
    action: "MEMORY_DELETED",
    title: "추억을 정리했어요",
    detail: memory.title,
  });
  refreshMemories();
  return { ok: true };
}
