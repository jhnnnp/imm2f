"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/activityServer";
import { summarizePlanChange } from "@/features/collaboration/summarize";
import { applyDateSwitch, emptyDateDay, hasDateContent, landingDateDay, type DateDaySnapshot } from "@/features/date/dateDays";
import { parseDiscoverPlaceId } from "@/features/places/discover";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { stripLegacyDemoArchive, stripLegacyDemoPlan } from "./legacyDemo";
import {
  asPlanCoordinates,
  isUuidPlaceId,
  pickResolvedCoordinates,
  placeCoordinateLookup,
  planItemLngLat,
  regionHintFromTitle,
  withLookedUpCoordinates,
} from "./planCoordinates";
import type { CouplePlan, PlanItem, PlanKind } from "./types/plan";
import { isIsoDate, seoulTodayIso } from "@/lib/dates";
import { appendPlanItem } from "./appendPlanItem";
import { hasTripContent, tripDraftsWithActive, tripForDate, type TripDateSnapshot } from "@/features/trip/tripDates";

type PlanRow = {
  id: string;
  kind: PlanKind;
  title: string;
  subtitle: string;
  start_date?: string | null;
  day_count?: number;
  revision_id?: number;
};

type PlanItemRow = {
  client_id: string;
  place_id: string;
  place_name: string;
  category: string;
  start_time: string;
  duration_minutes: number;
  expected_cost: number;
  sort_order: number;
  memo: string;
  day_index: number | null;
  lng?: number | null;
  lat?: number | null;
};

function normalizeDay(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(6, Math.round(n));
}

function validPlanItems(value: unknown): value is PlanItem[] {
  if (!Array.isArray(value) || value.length > 200) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!item || typeof item !== "object") return false;
    if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) return false;
    ids.add(item.id);
    return typeof item.placeId === "string" && typeof item.placeName === "string" && item.placeName.trim() !== ""
      && typeof item.category === "string" && typeof item.memo === "string"
      && typeof item.startTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.startTime)
      && Number.isFinite(item.durationMinutes) && item.durationMinutes > 0
      && Number.isFinite(item.expectedCost) && item.expectedCost >= 0;
  });
}

function normalizePlanItem(item: PlanItem): PlanItem {
  return { ...item, dayIndex: normalizeDay(item.dayIndex), coordinates: asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]) };
}

function toItem(row: PlanItemRow): PlanItem {
  return {
    id: row.client_id,
    placeId: row.place_id,
    placeName: row.place_name,
    category: row.category,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    expectedCost: row.expected_cost,
    order: row.sort_order,
    memo: row.memo,
    dayIndex: normalizeDay(row.day_index),
    coordinates: asPlanCoordinates(row.lng, row.lat),
  };
}

function emptyPlan(persist: boolean): CouplePlan {
  return { persist, revision: 0, items: [], title: "", notes: "", startDate: null, dayCount: 1 };
}

function isMissingSchemaObject(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST204" ||
    Boolean(error.message?.includes("schema cache")) ||
    Boolean(error.message?.includes("does not exist"))
  );
}

type PlanningClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function attachStoredPlanCoordinates(
  supabase: PlanningClient,
  coupleId: string,
  items: PlanItem[],
) {
  if (!items.length) return items;
  const missingItems = items.filter(item => !asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]));
  if (!missingItems.length) return items;
  const uuidIds = [...new Set(missingItems.map(item => item.placeId).filter(isUuidPlaceId))];
  const discoverIds = [...new Set(missingItems.flatMap(item => {
    const parsed = parseDiscoverPlaceId(item.placeId);
    return parsed ? [parsed.externalPlaceId] : [];
  }))];
  // UUID and external place IDs are independent lookups. Mixed courses should
  // wait for one database round trip instead of starting the second afterwards.
  const results = await Promise.all([
    uuidIds.length ? supabase
      .from("places")
      .select("id, lng, lat, external_source, external_place_id")
      .eq("couple_id", coupleId)
      .in("id", uuidIds) : Promise.resolve({ data: [] }),
    discoverIds.length ? supabase
      .from("places")
      .select("id, lng, lat, external_source, external_place_id")
      .eq("couple_id", coupleId)
      .in("external_place_id", discoverIds) : Promise.resolve({ data: [] }),
  ]);
  const rows = results.flatMap(result => result.data ?? []);
  return withLookedUpCoordinates(items, placeCoordinateLookup(rows));
}

async function hydratePlanItemCoordinates(
  supabase: PlanningClient,
  coupleId: string,
  planId: string,
  title: string,
  items: PlanItem[],
) {
  if (!items.length) return items;
  let hydrated = await attachStoredPlanCoordinates(supabase, coupleId, items);
  const missing = hydrated.filter(item => !asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]));
  if (!missing.length) return hydrated;

  const region = regionHintFromTitle(title);
  const resolved = await Promise.all(missing.map(async item => {
    const parsed = parseDiscoverPlaceId(item.placeId);
    const query = [region, item.placeName].filter(Boolean).join(" ").trim() || item.placeName;
    const search = parsed?.source === "tourapi"
      ? (nextQuery: string) => searchTourPlacesRemote({ query: nextQuery, region: region || undefined })
      : (nextQuery: string) => searchKakaoPlacesRemote({ query: nextQuery });
    let result = await search(query);
    if ((!result.ok || !result.places.length) && region && query !== item.placeName) {
      result = await search(item.placeName);
    }
    if (!result.ok) return item;
    const coords = pickResolvedCoordinates(item, result.places);
    return coords ? { ...item, coordinates: coords } : item;
  }));
  const byId = new Map(resolved.map(item => [item.id, item]));
  hydrated = hydrated.map(item => byId.get(item.id) ?? item);

  const missingIds = new Set(missing.map(item => item.id));
  await Promise.all(hydrated.flatMap(item => {
    if (!missingIds.has(item.id)) return [];
    const coords = asPlanCoordinates(item.coordinates?.[0], item.coordinates?.[1]);
    if (!coords) return [];
    return [supabase.from("plan_items").update({ lng: coords[0], lat: coords[1] }).eq("plan_id", planId).eq("client_id", item.id).eq("place_id", item.placeId).eq("place_name", item.placeName).is("lng", null).is("lat", null)];
  }));
  return hydrated;
}

export const loadCouplePlan = cache(async (kind: PlanKind): Promise<CouplePlan> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return emptyPlan(false);
  const supabase = await createClient();
  if (!supabase) return emptyPlan(false);

  let planQuery = await supabase
    .from("plans")
    .select("id, kind, title, subtitle, start_date, day_count, revision_id")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .maybeSingle();
  if (planQuery.error && isMissingSchemaObject(planQuery.error)) {
    planQuery = await supabase
      .from("plans")
      .select("id, kind, title, subtitle, start_date, day_count")
      .eq("couple_id", session.coupleId)
      .eq("kind", kind)
      .maybeSingle();
  }
  if (planQuery.error && isMissingSchemaObject(planQuery.error)) {
    planQuery = await supabase
      .from("plans")
      .select("id, kind, title, subtitle")
      .eq("couple_id", session.coupleId)
      .eq("kind", kind)
      .maybeSingle();
  }
  if (planQuery.error) throw new Error("일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  const plan = planQuery.data as PlanRow | null;
  if (!plan) return emptyPlan(true);

  let itemRows: Array<Partial<PlanItemRow> & { client_id: string; place_id: string; place_name: string; category: string; start_time: string; duration_minutes: number; expected_cost: number; sort_order: number; memo: string }> | null = null;
  const withCoords = await supabase
    .from("plan_items")
    .select("client_id, place_id, place_name, category, start_time, duration_minutes, expected_cost, sort_order, memo, day_index, lng, lat")
    .eq("plan_id", plan.id)
    .order("day_index", { ascending: true })
    .order("sort_order", { ascending: true });
  if (!withCoords.error) {
    itemRows = withCoords.data;
  } else {
    if (!isMissingSchemaObject(withCoords.error)) throw new Error("일정의 장소를 불러오지 못했어요.");
    const withDay = await supabase
      .from("plan_items")
      .select("client_id, place_id, place_name, category, start_time, duration_minutes, expected_cost, sort_order, memo, day_index")
      .eq("plan_id", plan.id)
      .order("day_index", { ascending: true })
      .order("sort_order", { ascending: true });
    if (!withDay.error) {
      itemRows = withDay.data;
    } else {
      if (!isMissingSchemaObject(withDay.error)) throw new Error("일정의 장소를 불러오지 못했어요.");
      const withoutDay = await supabase
        .from("plan_items")
        .select("client_id, place_id, place_name, category, start_time, duration_minutes, expected_cost, sort_order, memo")
        .eq("plan_id", plan.id)
        .order("sort_order", { ascending: true });
      if (withoutDay.error) throw new Error("일정의 장소를 불러오지 못했어요.");
      itemRows = withoutDay.data;
    }
  }

  let items = (itemRows ?? []).map(item => toItem(item as PlanItemRow));
  const subtitle = plan.subtitle ?? "";
  const stripped = stripLegacyDemoPlan({
    persist: true,
    revision: plan.revision_id ?? 0,
    items,
    title: plan.title ?? "",
    notes: /^\d+곳$/.test(subtitle.trim()) ? "" : subtitle,
    startDate: plan.start_date ?? null,
    dayCount: Math.max(1, plan.day_count ?? 1, items.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1)),
  });
  const liveItems = await attachStoredPlanCoordinates(supabase, session.coupleId, stripped.items);
  return { ...stripped, items: liveItems };
});

export async function hydrateCouplePlanCoordinates(kind: PlanKind): Promise<CouplePlan> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return emptyPlan(false);
  const supabase = await createClient();
  if (!supabase) return emptyPlan(false);

  const base = await loadCouplePlan(kind);
  if (!base.persist) return base;

  let planQuery = await supabase
    .from("plans")
    .select("id, title")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .maybeSingle();
  const plan = planQuery.data as { id: string; title?: string } | null;
  if (!plan?.id) return base;

  const items = await hydratePlanItemCoordinates(supabase, session.coupleId, plan.id, plan.title ?? "", base.items);
  return { ...base, items };
}

export async function addItemToCouplePlan(kind: PlanKind, item: PlanItem, options?: { targetDate?: string }): Promise<{ ok: true; duplicate: boolean; items: PlanItem[] } | { error: string }> {
  if (!["date", "trip"].includes(kind) || !validPlanItems([item]) || (kind === "trip" && (!Number.isInteger(item.dayIndex) || item.dayIndex < 0 || item.dayIndex > 6)) || (options?.targetDate !== undefined && options.targetDate !== "" && !isIsoDate(options.targetDate))) {
    return { error: "장소를 담을 날짜와 일정을 확인해 주세요." };
  }
  const current = await loadCouplePlan(kind);
  if (!current.persist) return { error: "로그인 후 우리의일정에 저장할 수 있어요." };
  if (kind === "date" && options?.targetDate && !current.startDate && hasDateContent(current)) {
    return { error: "날짜 미정 코스가 있어요. Date에서 그 코스의 날짜를 먼저 정한 뒤 다른 날에 장소를 담아 주세요." };
  }
  const tripTarget = kind === "trip" && options?.targetDate !== undefined
    ? tripForDate(current, await listTripDrafts(), options.targetDate) : current;
  const target = kind === "date" && options?.targetDate !== undefined
    ? options.targetDate === ""
      ? current.startDate ? emptyDateDay("") : { items: current.items, title: current.title, notes: current.notes, date: "" }
      : landingDateDay({ plan: current, drafts: await listDateDrafts(), today: options.targetDate }).focus
    : { items: tripTarget.items, title: tripTarget.title, notes: tripTarget.notes, date: tripTarget.startDate };
  const appended = appendPlanItem(target.items, item, kind);
  if (appended.error) return { error: appended.error };
  if (appended.duplicate) return { ok: true, duplicate: true, items: appended.items };
  const saved = await saveCouplePlan(kind, appended.items, {
    title: target.title || undefined,
    subtitle: target.notes,
    startDate: target.date || null,
    dayCount: kind === "date" ? 1 : Math.max(tripTarget.dayCount, item.dayIndex + 1),
    expectedRevision: current.revision,
  });
  if ("error" in saved) return saved;
  return { ok: true, duplicate: false, items: appended.items };
}

export async function saveCouplePlan(
  kind: PlanKind,
  items: PlanItem[],
  meta?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number; expectedRevision?: number; preservePreviousDate?: boolean; silent?: boolean; summary?: string },
): Promise<{ ok: true; version: number; revision: number } | { error: string; conflict?: boolean }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 우리의일정에 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  if (!["date", "trip"].includes(kind) || !validPlanItems(items)) return { error: "저장할 일정의 장소와 시간을 확인해 주세요." };
  if ((meta?.title !== undefined && typeof meta.title !== "string") || (meta?.subtitle !== undefined && typeof meta.subtitle !== "string") || (meta?.startDate != null && !isIsoDate(meta.startDate)) || (meta?.dayCount !== undefined && (!Number.isInteger(meta.dayCount) || meta.dayCount < 1 || meta.dayCount > 7))) return { error: "저장할 일정의 제목과 날짜를 확인해 주세요." };
  if (meta?.expectedRevision !== undefined && (!Number.isSafeInteger(meta.expectedRevision) || meta.expectedRevision < 0)) return { error: "일정을 다시 불러온 뒤 저장해 주세요." };
  const normalized = items.map(normalizePlanItem);

  let existingQuery = await supabase
    .from("plans")
    .select("id, start_date, title, subtitle, day_count, revision_id")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .maybeSingle();
  if (existingQuery.error && isMissingSchemaObject(existingQuery.error)) {
    existingQuery = await supabase
      .from("plans")
      .select("id, start_date, title, subtitle, day_count")
      .eq("couple_id", session.coupleId)
      .eq("kind", kind)
      .maybeSingle();
  }
  if (existingQuery.error && isMissingSchemaObject(existingQuery.error)) {
    existingQuery = await supabase
      .from("plans")
      .select("id, title, subtitle")
      .eq("couple_id", session.coupleId)
      .eq("kind", kind)
      .maybeSingle();
  }
  if (existingQuery.error) return { error: "기존 일정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  const existing = existingQuery.data as { id: string; start_date?: string | null; title?: string; subtitle?: string; day_count?: number; revision_id?: number } | null;

  if (meta?.expectedRevision !== undefined && meta.expectedRevision !== (existing?.revision_id ?? 0)) return { error: "파트너가 일정을 바꿨어요. 최신 일정을 확인하고 다시 저장해 주세요.", conflict: true };
  const title = meta?.title ?? existing?.title ?? (kind === "date" ? "우리가 고른 데이트" : "우리가 고른 여행");
  const subtitle = meta && "subtitle" in meta ? meta.subtitle ?? "" : existing?.subtitle ?? "";
  const maxDay = normalized.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1);
  const dayCount = Math.max(1, Math.min(7, meta?.dayCount ?? existing?.day_count ?? maxDay), maxDay);
  const startDate = meta && "startDate" in meta ? meta.startDate ?? null : undefined;

  const nextStart = startDate === undefined ? existing?.start_date ?? null : startDate;
  const previousQuery = existing?.id
    ? await supabase
      .from("plan_items")
      .select("*")
      .eq("plan_id", existing.id)
      .order("sort_order", { ascending: true })
    : { data: [] as PlanItemRow[], error: null };
  if (previousQuery.error) return { error: "기존 일정의 장소를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  const previousRows = previousQuery.data;
  const before = (previousRows ?? []).map(row => toItem(row as PlanItemRow));
  if (kind === "date" && nextStart && !existing?.start_date && meta?.preservePreviousDate !== false
    && hasDateContent({ title: existing?.title ?? "우리가 고른 데이트", notes: existing?.subtitle ?? "", items: before })) {
    return { error: "날짜 미정 코스가 있어요. Date에서 그 코스의 날짜를 먼저 정한 뒤 다른 날에 장소를 담아 주세요." };
  }
  const created = !existing?.id;
  const summary = meta?.summary ?? (created ? `${normalized.length}곳 일정 시작` : summarizePlanChange(before, normalized));
  const titleText = kind === "trip"
    ? created ? "여행 계획을 만들었어요" : "여행 계획을 수정했어요"
    : created ? "데이트 계획을 만들었어요" : "데이트 계획을 수정했어요";

  if (meta?.preservePreviousDate !== false && kind === "date" && existing?.start_date && existing.start_date !== nextStart
    && hasDateContent({ title: existing.title ?? "", notes: existing.subtitle ?? "", items: before })) {
    // Check the revision before preserving a snapshot from the previous date.
    if (meta?.expectedRevision !== undefined && existing.revision_id !== undefined && meta.expectedRevision !== existing.revision_id) return { error: "파트너가 일정을 바꿨어요. 최신 일정을 확인하고 다시 저장해 주세요.", conflict: true };
    const preserved = await saveDateDraft({ date: existing.start_date, title: existing.title ?? "우리가 고른 데이트", notes: existing.subtitle ?? "", items: before });
    if ("error" in preserved) return preserved;
  }

  const payload = normalized.map((item, order) => ({
    client_id: item.id,
    place_id: item.placeId,
    place_name: item.placeName,
    category: item.category,
    start_time: item.startTime,
    duration_minutes: Math.min(1440, Math.max(1, Math.round(item.durationMinutes))),
    expected_cost: Math.round(item.expectedCost),
    sort_order: order,
    memo: item.memo,
    day_index: item.dayIndex,
    ...planItemLngLat(item),
  }));
  const { data: saved, error: saveError } = await supabase.rpc("save_couple_plan_atomic", {
    target_kind: kind,
    target_title: title,
    target_subtitle: subtitle,
    target_start_date: nextStart,
    target_day_count: dayCount,
    target_items: payload,
    target_summary: summary,
    expected_revision: meta?.expectedRevision ?? existing?.revision_id ?? 0,
    expected_couple_id: session.coupleId,
  });
  if (saveError) {
    if (saveError.message.includes("WORKSPACE_CHANGED")) return { error: "파트너 연결이 변경됐어요. 새 공간의 일정을 불러온 뒤 다시 저장해 주세요.", conflict: true };
    if (saveError.message.includes("PLAN_CONFLICT")) {
      return { error: "상대가 이 계획을 먼저 수정했어요. 최신 내용을 다시 불러와 주세요.", conflict: true };
    }
    // Replacing all items requires the transaction and revision lock in the RPC.
    // A delete-then-insert fallback can erase a saved plan on a failed insert.
    return { error: "안전한 일정 저장 기능을 준비하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  const result = saved as { plan_id?: string; version?: number; revision?: number } | null;
  if (!result?.plan_id || !result.version || !result.revision) return { error: "일정을 저장하지 못했어요." };

  if (!meta?.silent && session.partner?.userId) {
    // The transaction is complete. Queue delivery after the response so an
    // outbox round trip does not hold the saved itinerary or next navigation.
    after(async () => {
      try { await queuePartnerEmail({
        coupleId: session.coupleId,
        actorUserId: session.userId,
        partnerUserId: session.partner?.userId ?? null,
        subject: `[ONLY US] ${titleText}`,
        body: `${session.displayName}님이 ${summary}`,
      }); } catch { /* Notification delivery must not turn a committed plan into a failed save. */ }
    });
  }

  revalidatePath("/");
  revalidatePath(`/${kind}`);
  if (kind === "trip") revalidatePath("/date");
  revalidatePath("/calendar");
  revalidatePath("/our-map");

  return { ok: true, version: result.version, revision: result.revision };
}

function parseDraftItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => validPlanItems([item])).map(item => normalizePlanItem(item as PlanItem));
}

export const listTripDrafts = cache(async (): Promise<TripDateSnapshot[]> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];
  const rows: Array<{ scheduled_on: string | null; title: string; notes: string; day_count: number; items: unknown; updated_at: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("trip_drafts")
      .select("scheduled_on,title,notes,day_count,items,updated_at").eq("couple_id", session.coupleId)
      .order("scheduled_on", { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error("날짜별 여행을 불러오지 못했어요. 현재 여행은 그대로 있어요.");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return rows.flatMap(row => {
    if (row.scheduled_on !== null && !isIsoDate(row.scheduled_on)) return [];
    const items = parseDraftItems(row.items);
    const snapshot = { startDate: row.scheduled_on ?? "", title: row.title || "우리가 고른 여행", notes: row.notes ?? "",
      dayCount: Math.max(1, Math.min(7, row.day_count || 1), ...items.map(item => item.dayIndex + 1)), items, updatedAt: row.updated_at };
    return hasTripContent(snapshot) ? [snapshot] : [];
  });
});

export async function readTripDate(startDate?: string | null) {
  if (startDate !== undefined && startDate !== null && startDate !== "" && !isIsoDate(startDate)) throw new Error("열려는 여행 날짜를 확인해 주세요.");
  const session = await getAppSession();
  const client = session.mode === "authenticated" ? await createClient() : null;
  const revision = async () => {
    if (!client || session.mode !== "authenticated") return 0;
    // These reads deliberately bypass React.cache: an older cached plan must
    // never be combined with a newer draft and accepted as a fresh snapshot.
    const result = await client.from("plans").select("revision_id")
      .eq("couple_id", session.coupleId).eq("kind", "trip").maybeSingle();
    if (result.error) throw new Error("여행의 최신 상태를 확인하지 못했어요. 다시 조회해 주세요.");
    return result.data?.revision_id ?? 0;
  };
  const before = await revision();
  const [active, drafts] = await Promise.all([loadCouplePlan("trip"), listTripDrafts()]);
  const after = await revision();
  if (before !== after || active.revision !== after) throw new Error("조회하는 동안 파트너가 여행을 변경했어요. 현재 여행은 그대로 있어요. 날짜를 다시 조회해 주세요.");
  const saved = tripDraftsWithActive(drafts, active);
  return { plan: startDate === undefined ? active : tripForDate(active, saved, startDate ?? ""), drafts: saved };
}

export async function rescheduleTripPlan(input: { startDate: string; expectedRevision: number; expectedTargetUpdatedAt?: string }): Promise<{ ok: true; revision: number } | { error: string; conflict?: boolean }> {
  if (!input || !isIsoDate(input.startDate) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || input.expectedTargetUpdatedAt !== undefined && (typeof input.expectedTargetUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.expectedTargetUpdatedAt)))) return { error: "옮길 날짜와 여행을 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 여행 날짜를 바꿀 수 있어요." };
  const client = await createClient();
  if (!client) return { error: "일정을 저장할 환경을 준비하지 못했어요." };
  const result = await client.rpc("reschedule_couple_trip", {
    target_start_date: input.startDate, expected_revision: input.expectedRevision,
    expected_target_updated_at: input.expectedTargetUpdatedAt ?? null,
    expected_couple_id: session.coupleId,
  });
  if (result.error) {
    if (result.error.message.includes("WORKSPACE_CHANGED")) return { error: "파트너 연결이 변경됐어요. 새 공간의 여행을 불러온 뒤 다시 날짜를 바꿔 주세요.", conflict: true };
    const occupied = result.error.message.includes("TRIP_DATE_OCCUPIED");
    const conflict = result.error.message.includes("PLAN_CONFLICT");
    return { error: occupied ? "옮길 날짜의 여행이 변경됐어요. 내용을 다시 확인한 후 날짜를 바꿔 주세요."
      : conflict ? "파트너가 여행을 바꿨어요. 최신 여행을 확인해 주세요." : "여행 날짜를 바꾸지 못했어요. 현재 여행은 그대로 있어요.", conflict: occupied || conflict };
  }
  const value = result.data as { plan_id?: string; revision?: number } | null;
  if (!value?.plan_id || !value.revision) return { error: "여행 날짜 변경 결과를 확인하지 못했어요. 최신 여행을 불러와 주세요." };
  revalidatePath("/trip"); revalidatePath("/date"); revalidatePath("/calendar"); revalidatePath("/our-map");
  return { ok: true, revision: value.revision };
}

export const listDateDrafts = cache(async (): Promise<DateDaySnapshot[]> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("date_drafts")
    .select("scheduled_on, title, notes, items")
    .eq("couple_id", session.coupleId)
    .order("scheduled_on", { ascending: true });
  if (!error) {
    return (data ?? []).map(row => ({
      date: row.scheduled_on,
      title: row.title || "우리가 고른 데이트",
      notes: row.notes ?? "",
      items: parseDraftItems(row.items),
    }));
  }
  if (!isMissingSchemaObject(error)) throw new Error("날짜별 일정을 불러오지 못했어요.");
  const fallback = await supabase
    .from("activities")
    .select("entity_id, after_value, created_at")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "date_draft")
    .order("created_at", { ascending: false });
  if (fallback.error) throw new Error("저장된 일정을 불러오지 못했어요.");
  if (!fallback.data) return [];
  const byDate = new Map<string, DateDaySnapshot>();
  for (const row of fallback.data) {
    const date = row.entity_id;
    if (!date || byDate.has(date)) continue;
    const value = row.after_value && typeof row.after_value === "object" && !Array.isArray(row.after_value)
      ? row.after_value as { title?: string; notes?: string; items?: unknown; deleted?: boolean }
      : {};
    if (value.deleted) {
      byDate.set(date, emptyDateDay(date));
      continue;
    }
    byDate.set(date, {
      date,
      title: value.title || "우리가 고른 데이트",
      notes: value.notes ?? "",
      items: parseDraftItems(value.items),
    });
  }
  return [...byDate.values()].filter(hasDateContent);
});

export async function saveDateDraft(day: DateDaySnapshot): Promise<{ ok: true } | { error: string }> {
  if (!day || typeof day.date !== "string" || (day.date !== "" && !isIsoDate(day.date)) || typeof day.title !== "string" || typeof day.notes !== "string" || !validPlanItems(day.items)) return { error: "날짜별 일정의 날짜와 장소를 확인해 주세요." };
  if (!day.date) return { ok: true };
  revalidatePath("/date");
  revalidatePath("/calendar");
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 데이트를 나눠 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const keep = hasDateContent(day);
  if (!keep) {
    const removed = await supabase.from("date_drafts").delete().eq("couple_id", session.coupleId).eq("scheduled_on", day.date);
    if (removed.error && isMissingSchemaObject(removed.error)) {
      const fallback = await supabase.from("activities").insert({
        couple_id: session.coupleId,
        actor_user_id: session.userId,
        entity_type: "date_draft",
        entity_id: day.date,
        action: "DATE_DRAFT",
        title: "",
        detail: "",
        after_value: { deleted: true },
      });
      if (fallback.error) return { error: "날짜별 일정 삭제를 저장하지 못했어요. 다시 시도해 주세요." };
      return { ok: true };
    }
    if (removed.error) return { error: removed.error.message };
    return { ok: true };
  }
  const payload = {
    couple_id: session.coupleId,
    scheduled_on: day.date,
    title: day.title,
    notes: day.notes,
    items: day.items.map(normalizePlanItem),
  };
  const { error } = await supabase.from("date_drafts").upsert(payload, { onConflict: "couple_id,scheduled_on" });
  if (!error) return { ok: true };
  if (!isMissingSchemaObject(error)) return { error: error.message };
  const { error: fallbackError } = await supabase.from("activities").insert({
    couple_id: session.coupleId,
    actor_user_id: session.userId,
    entity_type: "date_draft",
    entity_id: day.date,
    action: "DATE_DRAFT",
    title: day.title,
    detail: `${day.items.length}곳`,
    after_value: { title: day.title, notes: day.notes, items: payload.items, date: day.date },
  });
  if (fallbackError) return { error: fallbackError.message };
  return { ok: true };
}

export async function openDateDay(input: {
  fromDate: string | null;
  toDate: string | null;
  snapshot: { title: string; notes: string; items: PlanItem[] };
  expectedRevision: number;
  expectedTargetSnapshot?: DateDaySnapshot | null;
}): Promise<{ ok: true; revision: number; focus: DateDaySnapshot; drafts: DateDaySnapshot[] } | { error: string; conflict?: boolean }> {
  if (!input || (input.fromDate != null && input.fromDate !== "" && !isIsoDate(input.fromDate)) || (input.toDate != null && input.toDate !== "" && !isIsoDate(input.toDate)) || !input.snapshot || typeof input.snapshot.title !== "string" || typeof input.snapshot.notes !== "string" || !validPlanItems(input.snapshot.items) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return { error: "열려는 일정의 날짜와 장소를 확인해 주세요." };
  const active = await loadCouplePlan("date");
  if (!active.persist) return { error: "로그인 후 날짜별 일정을 열 수 있어요." };
  if (active.revision !== input.expectedRevision) return { error: "파트너가 일정을 바꿨어요. 최신 일정을 확인해 주세요.", conflict: true };
  const current: DateDaySnapshot = {
    date: input.fromDate ?? "",
    title: input.snapshot.title,
    notes: input.snapshot.notes,
    items: input.snapshot.items.map(normalizePlanItem),
  };
  const drafts = await listDateDrafts();
  if (input.fromDate == null && input.toDate && input.expectedTargetSnapshot !== undefined) {
    if (active.startDate || !hasDateContent(current)) return { error: "날짜 미정 코스를 다시 확인한 뒤 날짜를 정해 주세요.", conflict: true };
    const target = drafts.find(day => day.date === input.toDate) ?? null;
    const expected = input.expectedTargetSnapshot;
    const content = (day: DateDaySnapshot | null) => day && [day.date, day.title, day.notes,
      day.items.map(item => [item.id, item.placeId, item.placeName, item.category, item.startTime,
        item.durationMinutes, item.expectedCost, item.order, item.memo, item.dayIndex])];
    if (expected && (expected.date !== input.toDate || typeof expected.title !== "string" || typeof expected.notes !== "string" || !validPlanItems(expected.items))) return { error: "날짜를 다시 확인한 뒤 코스를 저장해 주세요." };
    if (JSON.stringify(content(target)) !== JSON.stringify(content(expected))) {
      return { error: "고른 날짜의 데이트가 변경됐어요. 최신 내용을 확인하고 다시 날짜를 정해 주세요.", conflict: true };
    }
  }
  const switched = applyDateSwitch({ current, drafts, nextDate: input.toDate ?? "" });
  if (current.date && current.date !== switched.focus.date) {
    const stashed = switched.drafts.find(day => day.date === current.date);
    const savedDraft = await saveDateDraft(stashed ?? emptyDateDay(current.date));
    if ("error" in savedDraft) return savedDraft;
  }
  const saved = await saveCouplePlan("date", switched.focus.items, {
    title: switched.focus.title,
    subtitle: switched.focus.notes,
    startDate: switched.focus.date || null,
    dayCount: 1,
    expectedRevision: input.expectedRevision,
    preservePreviousDate: false,
    silent: true,
    summary: input.expectedTargetSnapshot !== undefined
      ? `${switched.focus.date} 데이트의 날짜를 정했어요`
      : switched.focus.date ? `${switched.focus.date} 일정을 열었어요` : "날짜 없는 일정을 열었어요",
  });
  if ("error" in saved) return saved;
  // The active plan is the authoritative snapshot of the opened day. A second
  // write here could fail after the revision advanced and make every retry stale.
  // It is included in list/landing reads and is stashed before a later switch.
  revalidatePath("/date");
  return { ok: true, revision: saved.revision, focus: switched.focus, drafts: switched.drafts };
}

export type ArchivedDatePlan = {
  id: string;
  title: string;
  date: string;
  notes: string;
  items: PlanItem[];
};

export const listArchivedDatePlans = cache(async (): Promise<{ persist: boolean; dates: ArchivedDatePlan[] }> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, dates: [] };
  const supabase = await createClient();
  if (!supabase) return { persist: false, dates: [] };
  const { data: memories, error } = await supabase
    .from("memories")
    .select("id, title, happened_on, description")
    .eq("couple_id", session.coupleId)
    .eq("memory_type", "date")
    .order("happened_on", { ascending: false });
  if (error) throw new Error("데이트 기록을 불러오지 못했어요. 다시 시도해 주세요.");
  if (!memories?.length) return { persist: true, dates: [] };
  const ids = memories.map(memory => memory.id);
  const { data: snapshots, error: snapshotError } = await supabase
    .from("activities")
    .select("entity_id, after_value")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "date_archive")
    .in("entity_id", ids);
  if (snapshotError) throw new Error("저장된 기록의 장소를 불러오지 못했어요. 다시 시도해 주세요.");
  const byId = new Map((snapshots ?? []).map(row => [row.entity_id, Array.isArray(row.after_value) ? row.after_value as PlanItem[] : []]));
  return {
    persist: true,
    dates: memories.map(memory => ({
      id: memory.id,
      title: memory.title,
      date: memory.happened_on,
      notes: memory.description,
      items: (byId.get(memory.id) ?? []).map(normalizePlanItem),
    })),
  };
});

export async function archiveDatePlan(input: { title: string; date: string; notes: string; items: PlanItem[] }): Promise<{ ok: true; id: string } | { error: string }> {
  if (typeof input.title !== "string" || typeof input.notes !== "string" || typeof input.date !== "string" || (input.date !== "" && !isIsoDate(input.date)) || !validPlanItems(input.items)) return { error: "기록할 일정의 날짜와 장소를 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 우리의기록으로 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const normalized = input.items.map(normalizePlanItem);
  const { data: memory, error } = await supabase.from("memories").insert({
    couple_id: session.coupleId,
    memory_type: "date",
    title: input.title.trim() || "우리의 데이트",
    happened_on: input.date || seoulTodayIso(),
    description: input.notes.trim(),
    location_label: normalized.map(item => item.placeName).slice(0, 3).join(" · "),
    created_by: session.userId,
  }).select("id").single();
  if (error || !memory) return { error: error?.message ?? "데이트 기록을 저장하지 못했어요." };
  const recorded = await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "date_archive",
    entityId: memory.id,
    action: "MEMORY_ADDED",
    title: "지난 데이트를 기록했어요",
    detail: `${normalized.length}곳 · ${input.title}`,
    afterValue: normalized,
  });
  if ("error" in recorded) {
    await supabase.from("memories").delete().eq("id", memory.id).eq("couple_id", session.coupleId);
    return recorded;
  }
  revalidatePath("/date");
  revalidatePath("/memories");
  revalidatePath("/calendar");
  return { ok: true, id: memory.id };
}

export type ArchivedTripPlan = {
  id: string;
  title: string;
  startDate: string;
  dayCount: number;
  notes?: string;
  status: "completed";
  items: PlanItem[];
};

export const listArchivedTripPlans = cache(async (): Promise<ArchivedTripPlan[]> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];
  const { data: memories, error } = await supabase
    .from("memories")
    .select("id, title, happened_on")
    .eq("couple_id", session.coupleId)
    .eq("memory_type", "trip")
    .order("happened_on", { ascending: false });
  if (error) throw new Error("여행 기록을 불러오지 못했어요. 다시 시도해 주세요.");
  if (!memories?.length) return [];
  const ids = memories.map(memory => memory.id);
  const { data: snapshots, error: snapshotError } = await supabase
    .from("activities")
    .select("entity_id, after_value")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "trip_archive")
    .in("entity_id", ids);
  if (snapshotError) throw new Error("저장된 기록의 장소를 불러오지 못했어요. 다시 시도해 주세요.");
  const byId = new Map((snapshots ?? []).map(row => {
    const value = row.after_value && typeof row.after_value === "object" && !Array.isArray(row.after_value)
      ? row.after_value as { items?: PlanItem[]; dayCount?: number; notes?: string; startDate?: string }
      : {};
    return [row.entity_id, value] as const;
  }));
  return memories.flatMap(memory => {
    const snapshot = byId.get(memory.id);
    const items = parseDraftItems(snapshot?.items);
    const maxDay = items.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1);
    const journey = stripLegacyDemoArchive({
      id: memory.id,
      title: memory.title,
      startDate: typeof snapshot?.startDate === "string" ? snapshot.startDate : memory.happened_on,
      dayCount: Math.max(1, Math.min(7, Number.isInteger(snapshot?.dayCount) ? snapshot!.dayCount! : maxDay), maxDay),
      notes: typeof snapshot?.notes === "string" ? snapshot.notes : "",
      status: "completed" as const,
      items,
    });
    return journey ? [journey] : [];
  });
});

export async function archiveTripPlan(input: { title: string; startDate: string; dayCount: number; notes?: string; items: PlanItem[] }): Promise<{ ok: true; id: string } | { error: string }> {
  if (!input || typeof input.title !== "string" || typeof input.startDate !== "string" || (input.startDate !== "" && !isIsoDate(input.startDate)) || !Number.isInteger(input.dayCount) || input.dayCount < 1 || input.dayCount > 7 || (input.notes !== undefined && typeof input.notes !== "string") || !validPlanItems(input.items) || !input.items.length) return { error: "기록할 일정의 날짜와 장소를 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 우리의기록으로 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const normalized = input.items.map(normalizePlanItem);
  const dayCount = Math.max(input.dayCount, ...normalized.map(item => item.dayIndex + 1));
  const { data: memory, error } = await supabase.from("memories").insert({
    couple_id: session.coupleId,
    memory_type: "trip",
    title: input.title.trim() || "우리의 여행",
    happened_on: input.startDate || seoulTodayIso(),
    description: input.notes?.trim() || `${dayCount}일 · ${normalized.length}곳`,
    location_label: normalized.map(item => item.placeName).slice(0, 3).join(" · "),
    created_by: session.userId,
  }).select("id").single();
  if (error || !memory) return { error: "여행 기록을 저장하지 못했어요." };
  const recorded = await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "trip_archive",
    entityId: memory.id,
    action: "MEMORY_ADDED",
    title: "지난 여행을 기록했어요",
    detail: `${dayCount}일 · ${normalized.length}곳 · ${input.title}`,
    afterValue: { items: normalized, dayCount, notes: input.notes ?? "", startDate: input.startDate },
  }).catch(() => ({ error: "여행 기록의 장소를 저장하지 못했어요. 다시 시도해 주세요." }));
  if ("error" in recorded) {
    await supabase.from("memories").delete().eq("id", memory.id).eq("couple_id", session.coupleId);
    return recorded;
  }
  revalidatePath("/trip");
  revalidatePath("/date");
  revalidatePath("/our-map");
  revalidatePath("/memories");
  revalidatePath("/calendar");
  return { ok: true, id: memory.id };
}
