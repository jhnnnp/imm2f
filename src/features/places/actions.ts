"use server";

import { revalidatePath } from "next/cache";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/activityServer";
import { looksLikeNonVenue } from "@/lib/kakao/dateCandidate";
import { searchKakaoPlacesRemote, type KakaoSearchInput, type KakaoSearchResult } from "@/lib/kakao/local";
import { loadTourPlaceDetail as loadTourPlaceDetailRemote, searchTourPlacesRemote } from "@/lib/tourapi/client";
import { shouldSearchFestivals } from "@/lib/tourapi/festivalSchedule";
import { mapPlaceRow, visualToneForCategory } from "./mappers";
import { discoverSearchCategories, isAllowedKakaoDiscoverPlace, kakaoGroupCode } from "./config/kakaoCategories";
import { PLACE_CATEGORIES, usesTourApi } from "./config/placeCategories";
import { resolvePlaceLocation, type PlaceLocationInput, type PlaceLocationPatch } from "./location";
import { isManualPlaceAttemptId } from "./manualPlaceAttempt";
import type { DiscoverCandidate, Place, PlaceCategoryId, PlacePreferenceStatus } from "./types/place";
import type { Database } from "@/lib/supabase/database.types";

type PlaceRow = Database["public"]["Tables"]["places"]["Row"];
type PreferenceRow = Database["public"]["Tables"]["place_preferences"]["Row"];

export type CreatePlaceInput = {
  attemptId: string;
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
  | { ok: true; places: DiscoverCandidate[]; isEnd: boolean; page: number; totalCount: number }
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
  return value == null || !Number.isFinite(value) || value < 0 ? null : Math.round(value);
}

export const listPlaces = cache(async (): Promise<{ persist: boolean; places: Place[] }> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, places: [] };

  const supabase = await createClient();
  if (!supabase) return { persist: false, places: [] };

  // These reads depend only on the authenticated couple. Starting them together
  // avoids a second remote round trip after the places response arrives.
  const memberIds = [session.userId, session.partner?.userId].filter((id): id is string => Boolean(id));
  const [{ data, error }, preferencesResult, memoEdits] = await Promise.all([
    supabase.from("places").select("*").eq("couple_id", session.coupleId).order("created_at", { ascending: true }),
    supabase.from("place_preferences").select("*").in("user_id", memberIds),
    supabase.from("activities").select("entity_id, actor_user_id").eq("couple_id", session.coupleId).eq("entity_type", "place_memo").order("created_at", { ascending: false }),
  ]);

  if (error) throw new Error("저장한 장소를 불러오지 못했어요.");
  if (preferencesResult.error) throw new Error("둘의 장소 평가를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (memoEdits.error) throw new Error("장소 메모 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!data) return { persist: true, places: [] };
  const placeIds = new Set(data.map(row => row.id));
  const preferencesByPlace = new Map<string, PreferenceRow[]>();
  for (const preference of preferencesResult.data ?? []) {
    if (!placeIds.has(preference.place_id)) continue;
    const group = preferencesByPlace.get(preference.place_id) ?? [];
    group.push(preference);
    preferencesByPlace.set(preference.place_id, group);
  }
  const authors = new Map<string, string>();
  for (const row of memoEdits.data ?? []) {
    if (row.entity_id && placeIds.has(row.entity_id) && row.actor_user_id && !authors.has(row.entity_id)) authors.set(row.entity_id, row.actor_user_id);
  }
  return {
    persist: true,
    places: data.map(row => ({ ...toPlace(row, preferencesByPlace.get(row.id) ?? [], session.userId, session.partner?.userId ?? null), memoAuthorId: authors.get(row.id) })),
  };
});

export async function loadTourPlaceDetail(contentId: string, category: PlaceCategoryId,
  tourContentTypeId?: string) {
  return loadTourPlaceDetailRemote(contentId, category, tourContentTypeId);
}

export async function searchKakaoPlaces(input: KakaoSearchInput | string) {
  return searchDiscoverPlaces(input);
}

function keepDiscoverPlace(place: DiscoverCandidate) {
  return isAllowedKakaoDiscoverPlace(place) && !looksLikeNonVenue(place);
}

function toDiscoverSearchResult(result: KakaoSearchResult): DiscoverSearchResult {
  return result;
}

function discoverSearchPromise(promise: Promise<KakaoSearchResult>): Promise<DiscoverSearchResult> {
  return promise.then(toDiscoverSearchResult);
}

function discoverCategorySearches(params: DiscoverSearchInput, category: PlaceCategoryId): Promise<DiscoverSearchResult>[] {
  const { categories: _ignored, ...rest } = "categories" in params ? params : { ...params, categories: undefined };
  const categoryParams: KakaoSearchInput = { ...rest, category };
  const searches: Promise<DiscoverSearchResult>[] = [];
  if (shouldSearchFestivals(categoryParams) || usesTourApi(category)) {
    searches.push(discoverSearchPromise(searchTourPlacesRemote({
      ...categoryParams,
      category: shouldSearchFestivals(categoryParams) ? "festival" : category,
    })));
  }
  if (category === "book" || kakaoGroupCode(category)) {
    searches.push(discoverSearchPromise(searchKakaoPlacesRemote(categoryParams)));
  }
  return searches.length ? searches : [discoverSearchPromise(searchKakaoPlacesRemote(categoryParams))];
}

function mergeDiscoverResults(results: DiscoverSearchResult[], page: number): DiscoverSearchResult {
  const successful = results.filter((result): result is Extract<DiscoverSearchResult, { ok: true }> => result.ok);
  if (!successful.length) {
    return results[0] ?? { ok: false, code: "NO_RESULT", error: "장소를 불러오지 못했어요." };
  }
  const unique = new Map<string, DiscoverCandidate>();
  successful.flatMap(result => result.places).filter(keepDiscoverPlace).forEach(place => {
    unique.set(`${place.externalSource}:${place.externalPlaceId}`, place);
  });
  return {
    ok: true,
    places: [...unique.values()].slice(0, 36),
    isEnd: successful.every(result => result.isEnd),
    page,
    totalCount: successful.reduce((sum, result) => sum + result.totalCount, 0),
  };
}

export async function searchDiscoverPlaces(input: DiscoverSearchInput | string): Promise<DiscoverSearchResult> {
  const params = typeof input === "string" ? { query: input } : input;
  const categories = discoverSearchCategories(params);
  const searches = categories.flatMap(category => discoverCategorySearches(params, category));
  let raw: DiscoverSearchResult = mergeDiscoverResults(await Promise.all(searches), params.page ?? 1);
  if (!raw.ok) return raw;
  return { ...raw, places: raw.places.filter(keepDiscoverPlace) };
}

const PLACE_STATUSES: PlacePreferenceStatus[] = ["visited", "want", "must_visit", "revisit", "neutral", "dislike", "not_interested"];

function refreshPlaces() {
  revalidatePath("/");
  revalidatePath("/places");
  revalidatePath("/our-map");
}

const ACTIVE_PLACE_STATUSES: PlacePreferenceStatus[] = ["want", "must_visit", "revisit"];

async function ensureWantPreference(placeId: string, userId: string): Promise<{ duplicate: boolean } | { error: string }> {
  const supabase = await createClient();
  if (!supabase) return { error: "장소 상태를 저장할 수 없어요." };
  const { data, error } = await supabase
    .from("place_preferences")
    .select("status")
    .eq("place_id", placeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { error: "장소 상태를 확인하지 못했어요." };
  if (data && ACTIVE_PLACE_STATUSES.includes(data.status as PlacePreferenceStatus)) return { duplicate: true };
  const saved = await supabase.from("place_preferences").upsert({
    place_id: placeId,
    user_id: userId,
    status: "want",
    fit: 0,
  }, { onConflict: "place_id,user_id" });
  if (saved.error) return { error: "장소 상태를 저장하지 못했어요. 다시 시도해 주세요." };
  return { duplicate: false };
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
    const preference = await ensureWantPreference(existing.id, session.userId);
    if ("error" in preference) return preference;
    const nextDescription = input.description.trim();
    const { data: updated, error: updateError } = await supabase
      .from("places")
      .update({ description: nextDescription || existing.description })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateError) return { error: updateError.message };
    const row = updated ?? existing;
    refreshPlaces();
    const prefs = await loadPreferences([row.id]);
    return { place: toPlace(row, prefs, session.userId, session.partner?.userId ?? null), duplicate: preference.duplicate };
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
      duration_minutes: Number.isFinite(input.durationMinutes) ? Math.min(1440, Math.max(1, Math.round(input.durationMinutes))) : 60,
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
        const preference = await ensureWantPreference(raced.id, session.userId);
        if ("error" in preference) return preference;
        const nextDescription = input.description.trim();
        const { data: updated, error: updateError } = await supabase
          .from("places")
          .update({ description: nextDescription || raced.description })
          .eq("id", raced.id)
          .select("*")
          .single();
        if (updateError) return { error: updateError.message };
        const row = updated ?? raced;
        refreshPlaces();
        const prefs = await loadPreferences([row.id]);
        return { place: toPlace(row, prefs, session.userId, session.partner?.userId ?? null), duplicate: preference.duplicate };
      }
    }
    return { error: error.message };
  }
  if (!data) return { error: "장소를 저장하지 못했어요." };

  const preference = await ensureWantPreference(data.id, session.userId);
  if ("error" in preference) return preference;
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
  refreshPlaces();
  const prefs = await loadPreferences([data.id]);
  return { place: toPlace(data, prefs, session.userId, session.partner?.userId ?? null) };
}

export async function createPlace(input: CreatePlaceInput): Promise<{ place: Place } | { error: string }> {
  if (!input || !isManualPlaceAttemptId(input.attemptId)) return { error: "저장 요청을 확인하지 못했어요. 입력 화면을 다시 열어 주세요." };
  if (typeof input.name !== "string" || typeof input.district !== "string" || typeof input.description !== "string") return { error: "장소 정보를 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 장소를 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "저장 환경을 준비하지 못했어요." };

  const name = input.name.trim();
  if (!name) return { error: "장소 이름을 입력해 주세요." };
  // The attempt UUID is the row's existing primary key. Scope retries to the
  // creating member as well as the couple; never adopt somebody else's row.
  const readAttempt = () => supabase.from("places").select("*")
    .eq("id", input.attemptId).eq("couple_id", session.coupleId)
    .eq("created_by", session.userId).eq("external_source", "manual").maybeSingle();
  const previous = await readAttempt();
  if (previous.error) return { error: "이전 저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요." };
  let row = previous.data;
  if (!row) {
    const category = PLACE_CATEGORIES.find(item => item.id === input.category)?.id ?? "cafe";
    const categoryLabel = PLACE_CATEGORIES.find(item => item.id === category)?.label ?? "장소";
    const location = input.district.trim()
      ? await resolvePlaceLocation(name, { address: input.district, district: input.district })
      : null;
    const inserted = await supabase.from("places").insert({
      id: input.attemptId,
      couple_id: session.coupleId,
      name,
      category,
      category_label: categoryLabel,
      district: location?.district || input.district.trim(),
      address: location?.address || input.district.trim(),
      road_address: location?.roadAddress || null,
      lng: location?.coordinates?.[0] ?? null,
      lat: location?.coordinates?.[1] ?? null,
      map_url: location?.mapUrl ?? null,
      description: input.description.trim(),
      duration_minutes: Number.isFinite(input.durationMinutes) ? Math.min(1440, Math.max(1, Math.round(input.durationMinutes))) : 60,
      expected_cost_two: optionalCost(input.expectedCostTwo),
      visual_tone: visualToneForCategory(category),
      created_by: session.userId,
      external_source: "manual",
      opening_hours: null,
    }).select("*").single();
    row = inserted.data;
    if (inserted.error || !row) {
      // A lost response and a concurrent retry can both mean INSERT succeeded.
      // Read the same UUID instead of issuing another insert or overwriting it.
      const recovered = await readAttempt();
      if (recovered.error || !recovered.data) return { error: "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요." };
      row = recovered.data;
    }
  }

  const readPreferences = () => supabase.from("place_preferences").select("*").eq("place_id", row!.id);
  const before = await readPreferences();
  if (before.error) return { error: "장소 정보는 보관됐지만 상태를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요." };
  let preferences = before.data ?? [];
  let addedPreference = false;
  if (!preferences.some(preference => preference.user_id === session.userId)) {
    // INSERT preserves a status changed by another request between the read
    // and write. An upsert would restore 'want' over a later deliberate choice.
    const saved = await supabase.from("place_preferences").insert({ place_id: row.id, user_id: session.userId, status: "want", fit: 0 }).select("*").maybeSingle();
    if (!saved.error && saved.data) {
      preferences = [...preferences, saved.data];
      addedPreference = true;
    } else {
      const recovered = await readPreferences();
      if (recovered.error || !recovered.data?.some(preference => preference.user_id === session.userId)) return { error: "장소 정보는 보관됐지만 상태를 저장하지 못했어요. 같은 내용으로 다시 시도해 주세요." };
      preferences = recovered.data;
    }
  }
  // A fully completed replay returns the existing result without duplicate
  // partner emails. A retry after the first preference failure finishes here.
  if (addedPreference) {
    await recordCoupleActivity({ coupleId: session.coupleId, actorUserId: session.userId, entityType: "place", entityId: row.id,
      action: "PLACE_ADDED", title: "새 장소를 저장했어요", detail: row.name });
    await queuePartnerEmail({ coupleId: session.coupleId, actorUserId: session.userId, partnerUserId: session.partner?.userId ?? null,
      subject: `[ONLY US] ${session.displayName}님이 장소를 저장했어요`, body: `${row.name} · ${row.district || row.category_label}` });
  }
  refreshPlaces();
  return { place: toPlace(row, preferences, session.userId, session.partner?.userId ?? null) };
}

export async function updateMyPlaceStatus(placeId: string, status: PlacePreferenceStatus): Promise<{ ok: true } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 상태를 바꿀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  if (!PLACE_STATUSES.includes(status)) return { error: "장소 상태를 확인해 주세요." };
  const { error } = await supabase.from("place_preferences").upsert({
    place_id: placeId,
    user_id: session.userId,
    status,
  }, { onConflict: "place_id,user_id" });
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
  refreshPlaces();
  return { ok: true };
}

export async function lookupPlaceLocation(name: string, input: PlaceLocationInput): Promise<{ location: PlaceLocationPatch } | { error: string }> {
  const address = input.address.trim();
  if (!address) return { error: "주소를 입력해 주세요." };
  return { location: await resolvePlaceLocation(name, { address, district: input.district }) };
}

export async function updatePlaceDescription(placeId: string, description: string): Promise<{ place: Place } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 메모를 수정할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data, error } = await supabase
    .from("places")
    .update({ description: description.trim() })
    .eq("id", placeId)
    .eq("couple_id", session.coupleId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "메모를 저장하지 못했어요." };
  await supabase.from("activities").insert({ couple_id: session.coupleId, actor_user_id: session.userId, entity_type: "place_memo", entity_id: placeId, action: "PLACE_UPDATED", title: "장소 메모를 남겼어요", detail: data.name });
  revalidatePath("/places");
  revalidatePath("/our-map");
  const prefs = await loadPreferences([data.id]);
  return { place: { ...toPlace(data, prefs, session.userId, session.partner?.userId ?? null), memoAuthorId: session.userId } };
}

export async function updatePlaceLocation(placeId: string, input: PlaceLocationInput): Promise<{ place: Place } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 위치를 수정할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const address = input.address.trim();
  if (!address) return { error: "주소를 입력해 주세요." };

  const { data: current, error: loadError } = await supabase
    .from("places")
    .select("*")
    .eq("id", placeId)
    .eq("couple_id", session.coupleId)
    .maybeSingle();
  if (loadError || !current) return { error: loadError?.message ?? "장소를 찾지 못했어요." };

  const patch = await resolvePlaceLocation(current.name, { address, district: input.district });
  const { data, error } = await supabase
    .from("places")
    .update({
      address: patch.address,
      road_address: patch.roadAddress || null,
      district: patch.district,
      lng: patch.coordinates?.[0] ?? null,
      lat: patch.coordinates?.[1] ?? null,
      map_url: current.external_source === "kakao" ? (patch.mapUrl ?? null) : current.map_url,
    })
    .eq("id", placeId)
    .eq("couple_id", session.coupleId)
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "위치를 저장하지 못했어요." };
  refreshPlaces();
  const prefs = await loadPreferences([data.id]);
  return { place: toPlace(data, prefs, session.userId, session.partner?.userId ?? null) };
}
