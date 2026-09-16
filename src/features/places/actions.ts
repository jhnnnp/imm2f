"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/actions";
import { searchKakaoPlacesRemote, type KakaoSearchInput } from "@/lib/kakao/local";
import { loadTourPlaceDetail as loadTourPlaceDetailRemote, searchTourPlacesRemote } from "@/lib/tourapi/client";
import { applyRanking, rankDiscoverCandidates, type RankedCandidate } from "@/lib/openai/rank";
import { PLACES } from "./data/places";
import { mapPlaceRow, visualToneForCategory } from "./mappers";
import { PLACE_CATEGORIES, usesTourApi } from "./config/placeCategories";
import type { DiscoverCandidate, Place, PlaceCategoryId, PlacePreferenceStatus } from "./types/place";
import type { Database } from "@/lib/supabase/database.types";

type PlaceRow = Database["public"]["Tables"]["places"]["Row"];
type PreferenceRow = Database["public"]["Tables"]["place_preferences"]["Row"];

export type CreatePlaceInput = {
  name: string;
  category: PlaceCategoryId;
  district: string;
  description: string;
  durationMinutes: number;
  expectedCostTwo: number | null;
};

export type SaveKakaoPlaceInput = {
  candidate: DiscoverCandidate;
  description: string;
  durationMinutes: number;
  expectedCostTwo: number | null;
};

export type DiscoverSearchResult =
  | { ok: true; places: DiscoverCandidate[]; isEnd: boolean; page: number; totalCount: number; ranking?: RankedCandidate[] }
  | { ok: false; code: string; error: string };

export type DiscoverSearchInput = KakaoSearchInput | (Omit<KakaoSearchInput, "category"> & { categories: PlaceCategoryId[] });

async function loadPreferences(placeIds: string[]) {
  if (!placeIds.length) return [] as PreferenceRow[];
  const supabase = await createClient();
  if (!supabase) return [] as PreferenceRow[];
  const { data } = await supabase.from("place_preferences").select("*").in("place_id", placeIds);
  return data ?? [];
}

function toPlace(row: PlaceRow, prefs: PreferenceRow[], userId: string, partnerId: string | null): Place {
  return mapPlaceRow({ ...row, place_preferences: prefs.filter(item => item.place_id === row.id) }, userId, partnerId);
}

function optionalCost(value: number | null | undefined) {
  return value == null || Number.isNaN(value) ? null : value;
}

export async function listPlaces(): Promise<{ persist: boolean; places: Place[] }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, places: PLACES };

  const supabase = await createClient();
  if (!supabase) return { persist: false, places: PLACES };

  const { data, error } = await supabase
    .from("places")
    .select("*")
    .eq("couple_id", session.coupleId)
    .order("created_at", { ascending: true });

  if (error || !data) return { persist: true, places: [] };
  const prefs = await loadPreferences(data.map(row => row.id));
  return {
    persist: true,
    places: data.map(row => toPlace(row, prefs, session.userId, session.partner?.userId ?? null)),
  };
}

export async function loadTourPlaceDetail(contentId: string, category: PlaceCategoryId) {
  return loadTourPlaceDetailRemote(contentId, category);
}

export async function searchKakaoPlaces(input: KakaoSearchInput | string) {
  return searchDiscoverPlaces(input);
}

export async function searchDiscoverPlaces(input: DiscoverSearchInput | string): Promise<DiscoverSearchResult> {
  const params = typeof input === "string" ? { query: input } : input;
  const categories = "categories" in params ? [...new Set(params.categories)] : [];
  let raw: DiscoverSearchResult;
  if (categories.length > 0) {
    raw = await Promise.all(categories.map(category => {
      const categoryParams = { ...params, categories: undefined, category };
      return usesTourApi(category)
        ? searchTourPlacesRemote(categoryParams)
        : searchKakaoPlacesRemote(categoryParams);
    })).then(results => {
      const successful = results.filter((result): result is Extract<DiscoverSearchResult, { ok: true }> => result.ok);
      if (!successful.length) return results[0] ?? { ok: false as const, code: "NO_RESULT", error: "장소를 불러오지 못했어요." };
      const unique = new Map<string, DiscoverCandidate>();
      successful.flatMap(result => result.places).forEach(place => unique.set(`${place.externalSource}:${place.externalPlaceId}`, place));
      return {
        ok: true as const,
        places: [...unique.values()].slice(0, 36),
        isEnd: successful.every(result => result.isEnd),
        page: params.page ?? 1,
        totalCount: successful.reduce((sum, result) => sum + result.totalCount, 0),
      };
    });
  } else {
    const singleParams = params as KakaoSearchInput;
    raw = usesTourApi(singleParams.category)
      ? await searchTourPlacesRemote(singleParams)
      : await searchKakaoPlacesRemote(singleParams);
  }
  if (!raw.ok) return raw;
  if ((params.page ?? 1) > 1 || raw.places.length < 2) return raw;
  const { places: saved } = await listPlaces();
  const ranking = await rankDiscoverCandidates(raw.places, saved);
  if (!ranking) return raw;
  return { ...raw, places: applyRanking(raw.places, ranking), ranking };
}

async function ensureWantPreference(placeId: string, userId: string) {
  const supabase = await createClient();
  if (!supabase) return;
  const { data } = await supabase
    .from("place_preferences")
    .select("user_id")
    .eq("place_id", placeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return;
  await supabase.from("place_preferences").insert({
    place_id: placeId,
    user_id: userId,
    status: "want",
    fit: 0,
  });
}

export async function saveKakaoPlace(input: SaveKakaoPlaceInput): Promise<{ place: Place; duplicate?: boolean } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 장소를 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const candidate = input.candidate;
  const source = candidate.externalSource === "tourapi" ? "tourapi" : "kakao";
  const { data: existing } = await supabase
    .from("places")
    .select("*")
    .eq("couple_id", session.coupleId)
    .eq("external_source", source)
    .eq("external_place_id", candidate.externalPlaceId)
    .maybeSingle();

  if (existing) {
    await ensureWantPreference(existing.id, session.userId);
    const prefs = await loadPreferences([existing.id]);
    return { place: toPlace(existing, prefs, session.userId, session.partner?.userId ?? null), duplicate: true };
  }

  const { data, error } = await supabase
    .from("places")
    .insert({
      couple_id: session.coupleId,
      name: candidate.name,
      category: candidate.category,
      category_label: candidate.categoryLabel,
      district: candidate.district,
      address: candidate.address,
      road_address: candidate.roadAddress || null,
      phone: candidate.phone || null,
      map_url: candidate.mapUrl || null,
      opening_hours: candidate.openingHours || null,
      expected_cost_two: optionalCost(input.expectedCostTwo),
      description: input.description.trim(),
      duration_minutes: Number.isFinite(input.durationMinutes) ? input.durationMinutes : 60,
      lng: candidate.coordinates[0],
      lat: candidate.coordinates[1],
      image: candidate.image || null,
      visual_tone: visualToneForCategory(candidate.category),
      created_by: session.userId,
      external_source: source,
      external_place_id: candidate.externalPlaceId,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("places")
        .select("*")
        .eq("couple_id", session.coupleId)
        .eq("external_source", source)
        .eq("external_place_id", candidate.externalPlaceId)
        .maybeSingle();
      if (raced) {
        await ensureWantPreference(raced.id, session.userId);
        const prefs = await loadPreferences([raced.id]);
        return { place: toPlace(raced, prefs, session.userId, session.partner?.userId ?? null), duplicate: true };
      }
    }
    return { error: error.message };
  }
  if (!data) return { error: "장소를 저장하지 못했어요." };

  await ensureWantPreference(data.id, session.userId);
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "place",
    entityId: data.id,
    action: "PLACE_ADDED",
    title: "새 장소를 저장했어요",
    detail: data.name,
  });
  await queuePartnerEmail({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    partnerUserId: session.partner?.userId ?? null,
    subject: `[ONLY US] ${session.displayName}님이 장소를 저장했어요`,
    body: `${data.name} · ${data.district || data.category_label}`,
  });
  const prefs = await loadPreferences([data.id]);
  return { place: toPlace(data, prefs, session.userId, session.partner?.userId ?? null) };
}

export async function createPlace(input: CreatePlaceInput): Promise<{ place: Place } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 장소를 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const name = input.name.trim();
  if (!name) return { error: "장소 이름을 입력해 주세요." };
  const category = PLACE_CATEGORIES.find(item => item.id === input.category)?.id ?? "cafe";
  const categoryLabel = PLACE_CATEGORIES.find(item => item.id === category)?.label ?? "장소";

  const { data, error } = await supabase
    .from("places")
    .insert({
      couple_id: session.coupleId,
      name,
      category,
      category_label: categoryLabel,
      district: input.district.trim(),
      description: input.description.trim(),
      duration_minutes: Number.isFinite(input.durationMinutes) ? input.durationMinutes : 60,
      expected_cost_two: optionalCost(input.expectedCostTwo),
      visual_tone: visualToneForCategory(category),
      created_by: session.userId,
      external_source: "manual",
      opening_hours: null,
    })
    .select("*")
    .single();

  if (error || !data) return { error: error?.message ?? "장소를 저장하지 못했어요." };

  await ensureWantPreference(data.id, session.userId);
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "place",
    entityId: data.id,
    action: "PLACE_ADDED",
    title: "새 장소를 저장했어요",
    detail: data.name,
  });
  await queuePartnerEmail({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    partnerUserId: session.partner?.userId ?? null,
    subject: `[ONLY US] ${session.displayName}님이 장소를 저장했어요`,
    body: `${data.name} · ${data.district || data.category_label}`,
  });
  const prefs = await loadPreferences([data.id]);
  return { place: toPlace(data, prefs, session.userId, session.partner?.userId ?? null) };
}

export async function updateMyPlaceStatus(placeId: string, status: PlacePreferenceStatus): Promise<{ ok: true } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 상태를 바꿀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { error } = await supabase.from("place_preferences").upsert({
    place_id: placeId,
    user_id: session.userId,
    status,
  });
  if (error) return { error: error.message };

  if (status === "want" || status === "must_visit" || status === "revisit") {
    const { data: place } = await supabase.from("places").select("name").eq("id", placeId).maybeSingle();
    await recordCoupleActivity({
      coupleId: session.coupleId,
      actorUserId: session.userId,
      entityType: "place",
      entityId: placeId,
      action: "PLACE_LIKED",
      title: "장소 상태를 바꿨어요",
      detail: place?.name ? `${place.name} · ${status}` : status,
    });
  }
  return { ok: true };
}
