"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { mapActivityRows, type ActivityRecord } from "./activityMap";
import type { CoupleActivity } from "./types";

type ActivityRow = ActivityRecord;
type ActivityMutationScope = { userId: string; coupleId: string };

function matchesExpectedScope(expected: ActivityMutationScope | undefined, actual: ActivityMutationScope) {
  return expected === undefined || Boolean(expected && expected.userId === actual.userId && expected.coupleId === actual.coupleId);
}

// These rows also store the only persisted copy of a draft, archive or insight.
// Dismissing a feed story must not erase the underlying feature's data.
const STORED_ACTIVITY_TYPES = ["date_draft", "date_archive", "trip_archive", "couple_insight", "place_memo"];
const STORED_ACTIVITY_FILTER = `(${STORED_ACTIVITY_TYPES.join(",")})`;

async function loadNames(userIds: Array<string | null | undefined>, known: Map<string, string>) {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && Boolean(id) && !known.has(id)))];
  if (!ids.length) return known;
  const supabase = await createClient();
  if (!supabase) return known;
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  (data ?? []).forEach(row => known.set(row.id, row.display_name || "파트너"));
  return known;
}

export async function dismissCoupleActivity(id: string, expectedScope?: ActivityMutationScope) {
  return dismissCoupleActivities([id], expectedScope);
}

export async function dismissCoupleActivities(ids: string[], expectedScope?: ActivityMutationScope) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || ids.length > 200) return { error: "지울 이야기를 확인해 주세요." };
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { ok: true as const };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  if (!matchesExpectedScope(expectedScope, session)) return { error: "계정 정보가 바뀌었어요. 현재 공간에서 다시 시도해 주세요." };
  const supabase = await createClient();
  const service = createServiceClient();
  const scopedDelete = async (client: NonNullable<typeof supabase> | NonNullable<typeof service>) => {
    const [removed, hidden] = await Promise.all([
      client.from("activities").delete().in("id", unique).eq("couple_id", session.coupleId).not("entity_type", "in", STORED_ACTIVITY_FILTER).select("id"),
      client.from("activities").update({ title: "", detail: "" }).in("id", unique).eq("couple_id", session.coupleId).in("entity_type", STORED_ACTIVITY_TYPES).select("id"),
    ]);
    return { failed: Boolean(removed.error || hidden.error), deleted: (removed.data?.length ?? 0) + (hidden.data?.length ?? 0) };
  };

  let last = { failed: true, deleted: 0 };
  if (supabase) last = await scopedDelete(supabase);
  if ((last.failed || last.deleted === 0) && service) last = await scopedDelete(service);
  if (last.failed || (unique.length > 0 && last.deleted === 0)) return { error: "이야기를 지우지 못했어요." };
  return { ok: true as const };
}

export async function clearCoupleActivities(expectedScope?: ActivityMutationScope) {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  if (!matchesExpectedScope(expectedScope, session)) return { error: "계정 정보가 바뀌었어요. 현재 공간에서 다시 시도해 주세요." };
  const supabase = await createClient();
  const service = createServiceClient();
  const scopedClear = async (client: NonNullable<typeof supabase> | NonNullable<typeof service>) => {
    const [removed, hidden] = await Promise.all([
      client.from("activities").delete().eq("couple_id", session.coupleId).not("entity_type", "in", STORED_ACTIVITY_FILTER).select("id"),
      client.from("activities").update({ title: "", detail: "" }).eq("couple_id", session.coupleId).in("entity_type", STORED_ACTIVITY_TYPES),
    ]);
    return { failed: Boolean(removed.error || hidden.error) };
  };

  let last: { failed: boolean } = { failed: true };
  if (supabase) last = await scopedClear(supabase);
  if (last.failed && service) last = await scopedClear(service);
  if (last.failed) return { error: "이야기를 지우지 못했어요." };
  return { ok: true as const };
}

export async function loadCoupleActivities(limit = 20): Promise<CoupleActivity[]> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("activities")
    .select("id, action, title, detail, actor_user_id, created_at")
    .eq("couple_id", session.coupleId)
    .neq("entity_type", "date_draft")
    .neq("title", "")
    .order("created_at", { ascending: false })
    .limit(Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.round(limit))) : 20);
  if (error) throw new Error("이야기를 불러오지 못했어요.");

  const rows = (data ?? []) as ActivityRow[];
  const knownNames = new Map([[session.userId, session.displayName || "나"]]);
  if (session.partner) knownNames.set(session.partner.userId, session.partner.displayName || "파트너");
  const names = await loadNames(rows.map(row => row.actor_user_id), knownNames);
  return mapActivityRows(rows, names);
}
