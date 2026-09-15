"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/actions";
import type { CreateMemoryInput, Memory, MemoryPhoto, MemoryType } from "./types";

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
};

function toPhoto(row: PhotoRow): MemoryPhoto {
  return {
    id: row.id,
    storageUrl: row.storage_url,
    caption: row.caption,
    sortOrder: row.sort_order,
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

function toMemory(row: MemoryRow, photos: PhotoRow[]): Memory {
  const mapped = photos
    .filter(photo => photo.memory_id === row.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toPhoto);
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

  return {
    persist: true,
    memories: (data as MemoryRow[]).map(row => toMemory(row, (photos ?? []) as PhotoRow[])),
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
    const { data: photo, error: photoError } = await supabase
      .from("memory_photos")
      .insert({
        memory_id: data.id,
        storage_url: coverUrl,
        caption: "",
        sort_order: 0,
        latitude: lat,
        longitude: lng,
      })
      .select("*")
      .single();
    if (photoError) return { error: photoError.message };
    if (photo) photos = [photo as PhotoRow];
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

  return { memory };
}
