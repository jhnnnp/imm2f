"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import type { Json } from "@/lib/supabase/database.types";
import type { PlanItem, PlanKind } from "@/features/planning/types/plan";
import type { ActivityAction, CoupleActivity, PlanVersion } from "./types";

type ActivityRow = {
  id: string;
  action: string;
  title: string;
  detail: string;
  actor_user_id: string | null;
  created_at: string;
};

type VersionRow = {
  id: string;
  plan_kind: PlanKind;
  version_number: number;
  change_summary: string;
  created_by: string | null;
  created_at: string;
  snapshot: PlanItem[] | null;
};

const IMPORTANT_ACTIONS = new Set([
  "PLACE_ADDED",
  "TRIP_CREATED",
  "TRIP_UPDATED",
  "DATE_CREATED",
  "DATE_UPDATED",
  "PARTNER_JOINED",
  "MEMORY_ADDED",
  "VAULT_UPDATED",
  "GIFT_UPDATED",
  "BUCKET_UPDATED",
]);

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  return `${days}일 전`;
}

async function loadNames(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, string>();
  const supabase = await createClient();
  if (!supabase) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  return new Map((data ?? []).map(row => [row.id, row.display_name || "파트너"]));
}

export async function recordCoupleActivity(input: {
  coupleId: string;
  actorUserId: string;
  entityType: string;
  entityId?: string;
  action: ActivityAction;
  title: string;
  detail?: string;
  beforeValue?: Json;
  afterValue?: Json;
}) {
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.from("activities").insert({
    couple_id: input.coupleId,
    actor_user_id: input.actorUserId,
    entity_type: input.entityType,
    entity_id: input.entityId ?? "",
    action: input.action,
    title: input.title,
    detail: input.detail ?? "",
    before_value: input.beforeValue ?? null,
    after_value: input.afterValue ?? null,
  });
}

export async function queuePartnerEmail(input: {
  coupleId: string;
  actorUserId: string;
  partnerUserId: string | null;
  subject: string;
  body: string;
}) {
  if (!input.partnerUserId || input.partnerUserId === input.actorUserId) return;
  const supabase = await createClient();
  if (!supabase) return;
  await supabase.from("email_outbox").insert({
    couple_id: input.coupleId,
    recipient_user_id: input.partnerUserId,
    subject: input.subject,
    body: input.body,
    status: "queued",
  });
}

export async function loadCoupleActivities(limit = 20): Promise<CoupleActivity[]> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("activities")
    .select("id, action, title, detail, actor_user_id, created_at")
    .eq("couple_id", session.coupleId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as ActivityRow[];
  const names = await loadNames(rows.map(row => row.actor_user_id));

  return rows.map(row => ({
    id: row.id,
    action: row.action,
    title: row.title,
    detail: row.detail,
    actorName: row.actor_user_id ? names.get(row.actor_user_id) ?? "파트너" : "시스템",
    actorUserId: row.actor_user_id,
    important: IMPORTANT_ACTIONS.has(row.action),
    createdAt: relativeTime(row.created_at),
  }));
}

export async function loadPlanVersions(kind: PlanKind, limit = 12): Promise<{ versions: PlanVersion[]; latest: number }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { versions: [], latest: 0 };
  const supabase = await createClient();
  if (!supabase) return { versions: [], latest: 0 };

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .maybeSingle();
  if (!plan) return { versions: [], latest: 0 };

  const { data } = await supabase
    .from("plan_versions")
    .select("id, plan_kind, version_number, change_summary, created_by, created_at, snapshot")
    .eq("plan_id", plan.id)
    .order("version_number", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as VersionRow[];
  const names = await loadNames(rows.map(row => row.created_by));
  const versions = rows.map(row => ({
    id: row.id,
    planKind: row.plan_kind,
    versionNumber: row.version_number,
    changeSummary: row.change_summary,
    createdByName: row.created_by ? names.get(row.created_by) ?? "파트너" : "나",
    createdAt: relativeTime(row.created_at),
    snapshot: Array.isArray(row.snapshot) ? row.snapshot : [],
  }));

  return { versions, latest: versions[0]?.versionNumber ?? 0 };
}
