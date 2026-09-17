"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/actions";
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

function toPhoto(row: PhotoRow, signedUrl?: string): MemoryPhoto {
  return {
    id: row.id,
    storageUrl: signedUrl || row.storage_url,
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
  const hasCoords = Number.isFinite(row.lng) && Number.isFinite(row.lat);
  return {
    id: row.id,
    memoryType: row.memory_type,
    placeId: row.place_id,
    title: row.title,
    happenedOn: row.happened_on,
    description: row.description,
    locationLabel: row.location_label,
    coordinates: hasCoords ? [Number(row.lng), Number(row.lat)] : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    coverUrl: mapped[0]?.storageUrl ?? null,
    photos: mapped,
  };
}

export async function listMemories(): Promise<{ persist: boolean; memories: Memory[] }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, memories: [] };
  const supabase = await createClient();
  if (!supabase) return { persist: false, memories: [] };

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("couple_id", session.coupleId)
    .order("happened_on", { ascending: false });
  if (error || !data) return { persist: true, memories: [] };

  const ids = data.map(row => row.id);
  const { data: photos } = ids.length
    ? await supabase.from("memory_photos").select("*").in("memory_id", ids)
    : { data: [] as PhotoRow[] };

  const photoRows = (photos ?? []) as PhotoRow[];
  const signedEntries = await Promise.all(photoRows.filter(photo => photo.storage_path).map(async photo => {
    const signed = await supabase.storage.from("memory-photos").createSignedUrl(photo.storage_path!, 60 * 60);
    return [photo.id, signed.data?.signedUrl ?? ""] as const;
  }));
  const signedUrls = new Map(signedEntries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));

  return {
    persist: true,
    memories: (data as MemoryRow[]).map(row => toMemory(row, photoRows, signedUrls)),
  };
}

export async function createMemory(input: CreateMemoryInput): Promise<{ memory: Memory } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 추억을 남길 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const title = input.title.trim();
  if (!title) return { error: "추억 제목을 입력해 주세요." };
  const happenedOn = input.happenedOn || new Date().toISOString().slice(0, 10);

  let lng = input.lng ?? null;
  let lat = input.lat ?? null;
  let locationLabel = input.locationLabel.trim();
  let placeId = input.placeId || null;
  let coverUrl = input.coverUrl?.trim() || "";

  if (placeId) {
    const { data: place } = await supabase
      .from("places")
      .select("id, name, district, lng, lat, image")
      .eq("id", placeId)
      .eq("couple_id", session.coupleId)
      .maybeSingle();
    if (place) {
      if (!locationLabel) locationLabel = place.district || place.name;
      if (lng == null && place.lng != null) lng = place.lng;
      if (lat == null && place.lat != null) lat = place.lat;
      if (!coverUrl && place.image) coverUrl = place.image;
    } else {
      placeId = null;
    }
  }

  const { data, error } = await supabase
    .from("memories")
    .insert({
      couple_id: session.coupleId,
      memory_type: input.memoryType ?? "free",
      place_id: placeId,
      title,
      happened_on: happenedOn,
      description: input.description.trim(),
      location_label: locationLabel,
      lng,
      lat,
      created_by: session.userId,
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "추억을 저장하지 못했어요." };

  let photos: PhotoRow[] = [];
  if (coverUrl) {
    const photoInput = input.photo;
    const { data: photo, error: photoError } = await supabase
      .from("memory_photos")
      .insert({
        memory_id: data.id,
        storage_url: coverUrl,
        caption: "",
        sort_order: 0,
        latitude: lat,
        longitude: lng,
        captured_at: photoInput?.capturedAt ?? null,
        storage_path: photoInput?.storagePath ?? null,
        original_filename: photoInput?.originalFilename ?? "",
        mime_type: photoInput?.mimeType ?? "",
        file_size: photoInput?.fileSize ?? null,
        width: photoInput?.width ?? null,
        height: photoInput?.height ?? null,
        camera_make: photoInput?.cameraMake ?? "",
        camera_model: photoInput?.cameraModel ?? "",
        orientation: photoInput?.orientation ?? null,
        location_source: photoInput?.locationSource ?? (placeId ? "place" : "none"),
        metadata: photoInput?.metadata ?? {},
      })
      .select("*")
      .single();
    if (photoError) return { error: photoError.message };
    if (photo) {
      const signed = photo.storage_path
        ? await supabase.storage.from("memory-photos").createSignedUrl(photo.storage_path, 60 * 60)
        : null;
      photos = [{ ...photo, storage_url: signed?.data?.signedUrl || photo.storage_url } as PhotoRow];
    }
  }

  const memory = toMemory(data as MemoryRow, photos);
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "memory",
    entityId: memory.id,
    action: "MEMORY_ADDED",
    title: "추억을 남겼어요",
    detail: memory.title,
  });
  await queuePartnerEmail({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    partnerUserId: session.partner?.userId ?? null,
    subject: `[ONLY US] ${session.displayName}님이 추억을 남겼어요`,
    body: `${memory.title}${memory.locationLabel ? ` · ${memory.locationLabel}` : ""}`,
  });

  revalidatePath("/");

  return { memory };
}

export async function updateMemory(input: UpdateMemoryInput): Promise<{ memory: Memory } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const title = input.title.trim();
  if (!title) return { error: "추억 제목을 입력해 주세요." };
  const hasCoordinates = Number.isFinite(input.lng) && Number.isFinite(input.lat);

  const { data, error } = await supabase.from("memories").update({
    title,
    happened_on: input.happenedOn,
    description: input.description.trim(),
    location_label: input.locationLabel.trim(),
    memory_type: input.memoryType,
    lng: hasCoordinates ? input.lng : null,
    lat: hasCoordinates ? input.lat : null,
  }).eq("id", input.id).eq("couple_id", session.coupleId).select("*").single();
  if (error || !data) return { error: error?.message ?? "추억을 수정하지 못했어요." };

  await supabase.from("memory_photos").update({
    latitude: hasCoordinates ? input.lat : null,
    longitude: hasCoordinates ? input.lng : null,
    location_source: hasCoordinates ? "manual" : "none",
  }).eq("memory_id", input.id);

  const { data: photoData } = await supabase.from("memory_photos").select("*").eq("memory_id", input.id).order("sort_order");
  const photos = (photoData ?? []) as PhotoRow[];
  const signedEntries = await Promise.all(photos.filter(photo => photo.storage_path).map(async photo => {
    const signed = await supabase.storage.from("memory-photos").createSignedUrl(photo.storage_path!, 60 * 60);
    return [photo.id, signed.data?.signedUrl ?? ""] as const;
  }));
  const memory = toMemory(data as MemoryRow, photos, new Map(signedEntries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))));
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "memory",
    entityId: input.id,
    action: "MEMORY_UPDATED",
    title: "추억을 다듬었어요",
    detail: memory.title,
  });
  revalidatePath("/");
  return { memory };
}

export async function deleteMemory(memoryId: string): Promise<{ ok: true } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data: memory } = await supabase.from("memories").select("id, title").eq("id", memoryId).eq("couple_id", session.coupleId).maybeSingle();
  if (!memory) return { error: "삭제할 추억을 찾지 못했어요." };
  const { data: photos } = await supabase.from("memory_photos").select("storage_path").eq("memory_id", memoryId);
  const paths = (photos ?? []).map(photo => photo.storage_path).filter((path): path is string => Boolean(path));
  const { error } = await supabase.from("memories").delete().eq("id", memoryId).eq("couple_id", session.coupleId);
  if (error) return { error: error.message };
  if (paths.length) await supabase.storage.from("memory-photos").remove(paths);
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "memory",
    entityId: memoryId,
    action: "MEMORY_DELETED",
    title: "추억을 정리했어요",
    detail: memory.title,
  });
  revalidatePath("/");
  return { ok: true };
}
