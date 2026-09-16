"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail } from "@/features/collaboration/actions";
import { summarizePlanChange } from "@/features/collaboration/summarize";
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
};

function normalizeDay(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(6, Math.round(n));
}

function normalizePlanItem(item: PlanItem): PlanItem {
  return { ...item, dayIndex: normalizeDay(item.dayIndex) };
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
  };
}

function emptyPlan(persist: boolean): CouplePlan {
  return { persist, revision: 0, items: [], title: "", notes: "", startDate: null, dayCount: 1 };
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
  if (planQuery.error) {
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

  let items = (itemRows ?? []).map(item => toItem(item as PlanItemRow));
  const placeIds = [...new Set(items.map(item => item.placeId).filter(id => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)))];
  if (placeIds.length) {
    const { data: placeRows } = await supabase.from("places").select("id, lng, lat").in("id", placeIds);
    const coordinates = new Map((placeRows ?? []).filter(row => row.lng != null && row.lat != null).map(row => [row.id, [Number(row.lng), Number(row.lat)] as [number, number]]));
    items = items.map(item => ({ ...item, coordinates: coordinates.get(item.placeId) ?? null }));
  }
  const subtitle = plan.subtitle ?? "";
  const maxDay = items.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1);
  return {
    persist: true,
    revision: plan.revision_id ?? 0,
    items,
    title: plan.title ?? "",
    notes: /^\d+곳$/.test(subtitle.trim()) ? "" : subtitle,
    startDate: plan.start_date ?? null,
    dayCount: Math.max(1, plan.day_count ?? 1, maxDay),
  };
}

export async function saveCouplePlan(
  kind: PlanKind,
  items: PlanItem[],
  meta?: { title?: string; subtitle?: string; startDate?: string | null; dayCount?: number; expectedRevision?: number },
): Promise<{ ok: true; version: number; revision: number } | { error: string; conflict?: boolean }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { ok: true, version: 0, revision: 0 };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const normalized = items.map(normalizePlanItem);

  let existingQuery = await supabase
    .from("plans")
    .select("id, start_date, title, subtitle, day_count, revision_id")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .maybeSingle();
  if (existingQuery.error) {
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
  const summary = created ? `${normalized.length}곳 일정 시작` : summarizePlanChange(before, normalized);
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
    return { error: saveError.message };
  }
  const result = saved as { plan_id?: string; version?: number; revision?: number } | null;
  if (!result?.plan_id || !result.version || !result.revision) return { error: "일정을 저장하지 못했어요." };

  await queuePartnerEmail({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    partnerUserId: session.partner?.userId ?? null,
    subject: `[ONLY US] ${titleText}`,
    body: `${session.displayName}님이 ${summary}`,
  });

  return { ok: true, version: result.version, revision: result.revision };
}

export async function restorePlanVersion(kind: PlanKind, versionId: string): Promise<{ ok: true; items: PlanItem[]; version: number } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 복원할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data } = await supabase
    .from("plan_versions")
    .select("id, snapshot, couple_id")
    .eq("id", versionId)
    .eq("couple_id", session.coupleId)
    .eq("plan_kind", kind)
    .maybeSingle();
  if (!data?.snapshot || !Array.isArray(data.snapshot)) return { error: "이 버전을 찾지 못했어요." };

  const items = (data.snapshot as PlanItem[]).map(normalizePlanItem);
  const saved = await saveCouplePlan(kind, items);
  if ("error" in saved) return saved;
  return { ok: true, items, version: saved.version };
}
