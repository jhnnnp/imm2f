"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/actions";
import { summarizePlanChange } from "@/features/collaboration/summarize";
import { applyDateSwitch, emptyDateDay, hasDateContent, type DateDaySnapshot } from "@/features/date/dateDays";
import { parseDiscoverPlaceId } from "@/features/places/discover";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { isLegacyDemoTripTitle, stripLegacyDemoArchive, stripLegacyDemoPlan } from "./legacyDemo";
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

async function hydratePlanItemCoordinates(
  supabase: PlanningClient,
  coupleId: string,
  planId: string,
  title: string,
  items: PlanItem[],
) {
  if (!items.length) return items;
  const uuidIds = [...new Set(items.map(item => item.placeId).filter(isUuidPlaceId))];
  const discoverIds = [...new Set(items.flatMap(item => {
    const parsed = parseDiscoverPlaceId(item.placeId);
    return parsed ? [parsed.externalPlaceId] : [];
  }))];
  const rows: Array<{ id: string; lng: number | null; lat: number | null; external_source?: string | null; external_place_id?: string | null }> = [];
  if (uuidIds.length) {
    const { data } = await supabase
      .from("places")
      .select("id, lng, lat, external_source, external_place_id")
      .eq("couple_id", coupleId)
      .in("id", uuidIds);
    rows.push(...(data ?? []));
  }
  if (discoverIds.length) {
    const { data } = await supabase
      .from("places")
      .select("id, lng, lat, external_source, external_place_id")
      .eq("couple_id", coupleId)
      .in("external_place_id", discoverIds);
    rows.push(...(data ?? []));
  }

  let hydrated = withLookedUpCoordinates(items, placeCoordinateLookup(rows));
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
    return [supabase.from("plan_items").update({ lng: coords[0], lat: coords[1] }).eq("plan_id", planId).eq("client_id", item.id)];
  }));
  return hydrated;
}

type PlanWritePayload = {
  title: string;
  subtitle: string;
  start_date: string | null;
  day_count: number;
  revision_id: number;
};

function planWriteVariants(payload: PlanWritePayload) {
  return [
    payload,
    { title: payload.title, subtitle: payload.subtitle, start_date: payload.start_date, day_count: payload.day_count },
    { title: payload.title, subtitle: payload.subtitle },
  ] as const;
}

export async function loadCouplePlan(kind: PlanKind): Promise<CouplePlan> {
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
    const withDay = await supabase
      .from("plan_items")
      .select("client_id, place_id, place_name, category, start_time, duration_minutes, expected_cost, sort_order, memo, day_index")
      .eq("plan_id", plan.id)
      .order("day_index", { ascending: true })
      .order("sort_order", { ascending: true });
    if (!withDay.error) {
      itemRows = withDay.data;
    } else {
      const withoutDay = await supabase
        .from("plan_items")
        .select("client_id, place_id, place_name, category, start_time, duration_minutes, expected_cost, sort_order, memo")
        .eq("plan_id", plan.id)
        .order("sort_order", { ascending: true });
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
  const removedIds = items.filter(item => !stripped.items.some(keep => keep.id === item.id)).map(item => item.id);
  if (removedIds.length) {
    await supabase.from("plan_items").delete().eq("plan_id", plan.id).in("client_id", removedIds);
  }
  if (!stripped.items.length && (isLegacyDemoTripTitle(plan.title ?? "") || plan.subtitle === "근대 골목에서 시작해 섬의 노을로 끝나는 1박 2일")) {
    await supabase.from("plans").update({
      title: "우리가 고른 여행",
      subtitle: "",
      start_date: null,
      day_count: 1,
    }).eq("id", plan.id);
    revalidatePath("/trip");
    revalidatePath("/our-map");
    revalidatePath("/");
  }
  const liveItems = await hydratePlanItemCoordinates(supabase, session.coupleId, plan.id, plan.title ?? "", stripped.items);
  return { ...stripped, items: liveItems };
}

export async function addItemToCouplePlan(kind: PlanKind, item: PlanItem): Promise<{ ok: true; duplicate: boolean; items: PlanItem[] } | { error: string }> {
  const current = await loadCouplePlan(kind);
  if (!current.persist) return { error: "로그인 후 우리의일정에 저장할 수 있어요." };
  const duplicate = current.items.some(existing => existing.placeId === item.placeId || existing.placeName === item.placeName);
  if (duplicate) return { ok: true, duplicate: true, items: current.items };
  const last = current.items.at(-1);
  let startTime = item.startTime;
  if (last) {
    const [hours, minutes] = last.startTime.split(":").map(Number);
    const total = (hours || 0) * 60 + (minutes || 0) + (last.durationMinutes || 60) + 20;
    startTime = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  const next = [...current.items, { ...item, startTime, order: current.items.length }];
  const saved = await saveCouplePlan(kind, next, {
    title: current.title || undefined,
    subtitle: current.notes,
    startDate: current.startDate,
    dayCount: current.dayCount,
    expectedRevision: current.revision,
  });
  if ("error" in saved) return saved;
  return { ok: true, duplicate: false, items: next };
}

export async function saveCouplePlan(
  kind: PlanKind,
  items: PlanItem[],
  meta?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number; expectedRevision?: number; silent?: boolean; summary?: string },
): Promise<{ ok: true; version: number; revision: number } | { error: string; conflict?: boolean }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 우리의일정에 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

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
  const existing = existingQuery.data as { id: string; start_date?: string | null; title?: string; subtitle?: string; day_count?: number; revision_id?: number } | null;

  const title = meta?.title ?? existing?.title ?? (kind === "date" ? "우리가 고른 데이트" : "우리가 고른 여행");
  const subtitle = meta && "subtitle" in meta ? meta.subtitle ?? "" : existing?.subtitle ?? "";
  const maxDay = normalized.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1);
  const dayCount = Math.max(1, Math.min(7, meta?.dayCount ?? existing?.day_count ?? maxDay), maxDay);
  const startDate = meta && "startDate" in meta ? meta.startDate ?? null : undefined;

  const nextStart = startDate === undefined ? existing?.start_date ?? null : startDate;
  const { data: previousRows } = existing?.id
    ? await supabase
      .from("plan_items")
      .select("client_id, place_id, place_name, category, start_time, duration_minutes, expected_cost, sort_order, memo, day_index")
      .eq("plan_id", existing.id)
      .order("day_index", { ascending: true })
      .order("sort_order", { ascending: true })
    : { data: [] as PlanItemRow[] };
  const before = (previousRows ?? []).map(row => toItem(row as PlanItemRow));
  const created = !existing?.id;
  const summary = meta?.summary ?? (created ? `${normalized.length}곳 일정 시작` : summarizePlanChange(before, normalized));
  const titleText = kind === "trip"
    ? created ? "여행 계획을 만들었어요" : "여행 계획을 수정했어요"
    : created ? "데이트 계획을 만들었어요" : "데이트 계획을 수정했어요";

  const payload = normalized.map((item, order) => ({
    client_id: item.id,
    place_id: item.placeId,
    place_name: item.placeName,
    category: item.category,
    start_time: item.startTime,
    duration_minutes: item.durationMinutes,
    expected_cost: item.expectedCost,
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
    expected_revision: meta?.expectedRevision ?? null,
  });
  if (saveError) {
    if (saveError.message.includes("PLAN_CONFLICT")) {
      return { error: "상대가 이 계획을 먼저 수정했어요. 최신 내용을 다시 불러와 주세요.", conflict: true };
    }
    // Older deployments can have plan tables without the atomic RPC or newer
    // columns (revision_id / start_date / day_count) in PostgREST's schema cache.
    if (!isMissingSchemaObject(saveError)) return { error: saveError.message };

    const nextRevision = (existing?.revision_id ?? 0) + 1;
    const writePayload: PlanWritePayload = {
      title,
      subtitle,
      start_date: nextStart,
      day_count: dayCount,
      revision_id: nextRevision,
    };
    let planId = existing?.id;
    let writeError: { message?: string } | null = null;

    if (planId) {
      for (const fields of planWriteVariants(writePayload)) {
        const update = await supabase
          .from("plans")
          .update(fields)
          .eq("id", planId)
          .eq("couple_id", session.coupleId);
        if (!update.error) {
          writeError = null;
          break;
        }
        writeError = update.error;
        if (!isMissingSchemaObject(update.error)) break;
      }
      if (writeError) return { error: writeError.message ?? "일정을 저장하지 못했어요." };
    } else {
      for (const fields of planWriteVariants({ ...writePayload, revision_id: 1 })) {
        const insert = await supabase
          .from("plans")
          .insert({ couple_id: session.coupleId, kind, ...fields })
          .select("id")
          .single();
        if (!insert.error && insert.data) {
          planId = insert.data.id;
          writeError = null;
          break;
        }
        writeError = insert.error;
        if (!isMissingSchemaObject(insert.error)) break;
      }
      if (!planId) return { error: writeError?.message ?? "일정을 저장하지 못했어요." };
    }

    const removed = await supabase.from("plan_items").delete().eq("plan_id", planId);
    if (removed.error) return { error: removed.error.message };
    if (payload.length) {
      const withDay = payload.map(item => ({ ...item, plan_id: planId! }));
      let inserted = await supabase.from("plan_items").insert(withDay);
      if (inserted.error && isMissingSchemaObject(inserted.error)) {
        const withoutCoords = withDay.map(({ lng: _lng, lat: _lat, ...item }) => item);
        inserted = await supabase.from("plan_items").insert(withoutCoords);
        if (inserted.error && isMissingSchemaObject(inserted.error)) {
          const withoutDay = withoutCoords.map(({ day_index: _dayIndex, ...item }) => item);
          inserted = await supabase.from("plan_items").insert(withoutDay);
        }
      }
      if (inserted.error) return { error: inserted.error.message };
    }
    const { data: latestVersion } = await supabase
      .from("plan_versions")
      .select("version_number")
      .eq("plan_id", planId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fallbackVersion = (latestVersion?.version_number ?? 0) + 1;
    const versionInsert = await supabase.from("plan_versions").insert({
      couple_id: session.coupleId,
      plan_id: planId,
      plan_kind: kind,
      version_number: fallbackVersion,
      snapshot: payload,
      change_summary: summary,
      created_by: session.userId,
    });
    if (versionInsert.error) return { error: versionInsert.error.message };
    if (!meta?.silent) {
      await recordCoupleActivity({
        coupleId: session.coupleId,
        actorUserId: session.userId,
        entityType: "plan",
        entityId: planId,
        action: kind === "trip" ? (created ? "TRIP_CREATED" : "TRIP_UPDATED") : (created ? "DATE_CREATED" : "DATE_UPDATED"),
        title: titleText,
        detail: summary,
        afterValue: payload,
      });
    }
    revalidatePath("/");
    return { ok: true, version: fallbackVersion, revision: nextRevision };
  }
  const result = saved as { plan_id?: string; version?: number; revision?: number } | null;
  if (!result?.plan_id || !result.version || !result.revision) return { error: "일정을 저장하지 못했어요." };
  await Promise.all(normalized.flatMap(item => {
    const coords = planItemLngLat(item);
    if (coords.lng == null || coords.lat == null) return [];
    return [supabase.from("plan_items").update({ lng: coords.lng, lat: coords.lat }).eq("plan_id", result.plan_id!).eq("client_id", item.id)];
  }));

  if (!meta?.silent) {
    await queuePartnerEmail({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    partnerUserId: session.partner?.userId ?? null,
    subject: `[ONLY US] ${titleText}`,
    body: `${session.displayName}님이 ${summary}`,
  });
  }

  revalidatePath("/");

  return { ok: true, version: result.version, revision: result.revision };
}

function parseDraftItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => normalizePlanItem(item as PlanItem));
}

export async function listDateDrafts(): Promise<DateDaySnapshot[]> {
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
  if (!isMissingSchemaObject(error)) return [];
  const fallback = await supabase
    .from("activities")
    .select("entity_id, after_value, created_at")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "date_draft")
    .order("created_at", { ascending: false });
  if (fallback.error || !fallback.data) return [];
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
}

export async function saveDateDraft(day: DateDaySnapshot): Promise<{ ok: true } | { error: string }> {
  if (!day.date) return { ok: true };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 데이트를 나눠 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const keep = hasDateContent(day);
  if (!keep) {
    const removed = await supabase.from("date_drafts").delete().eq("couple_id", session.coupleId).eq("scheduled_on", day.date);
    if (removed.error && isMissingSchemaObject(removed.error)) {
      await supabase.from("activities").insert({
        couple_id: session.coupleId,
        actor_user_id: session.userId,
        entity_type: "date_draft",
        entity_id: day.date,
        action: "DATE_DRAFT",
        title: "",
        detail: "",
        after_value: { deleted: true },
      });
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
}): Promise<{ ok: true; revision: number; focus: DateDaySnapshot; drafts: DateDaySnapshot[] } | { error: string; conflict?: boolean }> {
  const current: DateDaySnapshot = {
    date: input.fromDate ?? "",
    title: input.snapshot.title,
    notes: input.snapshot.notes,
    items: input.snapshot.items.map(normalizePlanItem),
  };
  const drafts = await listDateDrafts();
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
    silent: true,
    summary: switched.focus.date ? `${switched.focus.date} 일정을 열었어요` : "날짜 없는 일정을 열었어요",
  });
  if ("error" in saved) return saved;
  if (switched.focus.date) {
    const focusedDraft = await saveDateDraft(switched.focus);
    if ("error" in focusedDraft) return focusedDraft;
  }
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

export async function listArchivedDatePlans(): Promise<{ persist: boolean; dates: ArchivedDatePlan[] }> {
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
  if (error || !memories?.length) return { persist: true, dates: [] };
  const ids = memories.map(memory => memory.id);
  const { data: snapshots } = await supabase
    .from("activities")
    .select("entity_id, after_value")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "date_archive")
    .in("entity_id", ids);
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
}

export async function archiveDatePlan(input: { title: string; date: string; notes: string; items: PlanItem[] }): Promise<{ ok: true; id: string } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 우리의기록으로 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const normalized = input.items.map(normalizePlanItem);
  const { data: memory, error } = await supabase.from("memories").insert({
    couple_id: session.coupleId,
    memory_type: "date",
    title: input.title.trim() || "우리의 데이트",
    happened_on: input.date || new Date().toISOString().slice(0, 10),
    description: input.notes.trim(),
    location_label: normalized.map(item => item.placeName).slice(0, 3).join(" · "),
    created_by: session.userId,
  }).select("id").single();
  if (error || !memory) return { error: error?.message ?? "데이트 기록을 저장하지 못했어요." };
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "date_archive",
    entityId: memory.id,
    action: "MEMORY_ADDED",
    title: "지난 데이트를 기록했어요",
    detail: `${normalized.length}곳 · ${input.title}`,
    afterValue: normalized,
  });
  revalidatePath("/date");
  return { ok: true, id: memory.id };
}

export type ArchivedTripPlan = {
  id: string;
  title: string;
  startDate: string;
  dayCount: number;
  status: "completed";
  items: PlanItem[];
};

export async function listArchivedTripPlans(): Promise<ArchivedTripPlan[]> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];
  const { data: memories, error } = await supabase
    .from("memories")
    .select("id, title, happened_on, description")
    .eq("couple_id", session.coupleId)
    .eq("memory_type", "trip")
    .order("happened_on", { ascending: false });
  if (error || !memories?.length) return [];
  const ids = memories.map(memory => memory.id);
  const { data: snapshots } = await supabase
    .from("activities")
    .select("entity_id, after_value")
    .eq("couple_id", session.coupleId)
    .eq("entity_type", "trip_archive")
    .in("entity_id", ids);
  const byId = new Map((snapshots ?? []).map(row => {
    const value = row.after_value && typeof row.after_value === "object" && !Array.isArray(row.after_value)
      ? row.after_value as { items?: PlanItem[]; dayCount?: number }
      : {};
    return [row.entity_id, value] as const;
  }));
  return memories.flatMap(memory => {
    const snapshot = byId.get(memory.id);
    const items = Array.isArray(snapshot?.items) ? snapshot.items.map(normalizePlanItem) : [];
    const maxDay = items.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1);
    const journey = stripLegacyDemoArchive({
      id: memory.id,
      title: memory.title,
      startDate: memory.happened_on,
      dayCount: Math.max(1, snapshot?.dayCount ?? maxDay),
      status: "completed" as const,
      items,
    });
    return journey ? [journey] : [];
  });
}

export async function archiveTripPlan(input: { title: string; startDate: string; dayCount: number; items: PlanItem[] }): Promise<{ ok: true; id: string } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 우리의기록으로 저장할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const normalized = input.items.map(normalizePlanItem);
  const { data: memory, error } = await supabase.from("memories").insert({
    couple_id: session.coupleId,
    memory_type: "trip",
    title: input.title.trim() || "우리의 여행",
    happened_on: input.startDate || new Date().toISOString().slice(0, 10),
    description: `${Math.max(1, input.dayCount)}일 · ${normalized.length}곳`,
    location_label: normalized.map(item => item.placeName).slice(0, 3).join(" · "),
    created_by: session.userId,
  }).select("id").single();
  if (error || !memory) return { error: error?.message ?? "여행 기록을 저장하지 못했어요." };
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "trip_archive",
    entityId: memory.id,
    action: "MEMORY_ADDED",
    title: "지난 여행을 기록했어요",
    detail: `${Math.max(1, input.dayCount)}일 · ${normalized.length}곳 · ${input.title}`,
    afterValue: { items: normalized, dayCount: Math.max(1, input.dayCount) },
  });
  revalidatePath("/trip");
  revalidatePath("/our-map");
  return { ok: true, id: memory.id };
}
