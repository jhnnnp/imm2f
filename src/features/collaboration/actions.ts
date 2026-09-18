"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import type { Json } from "@/lib/supabase/database.types";
import type { ActivityAction, CoupleActivity } from "./types";

type ActivityRow = {
  id: string;
  action: string;
  title: string;
  detail: string;
  actor_user_id: string | null;
  created_at: string;
};

const IMPORTANT_ACTIONS = new Set([
  "PLACE_ADDED",
  "TRIP_CREATED",
  "TRIP_UPDATED",
  "DATE_CREATED",
  "DATE_UPDATED",
  "PARTNER_JOINED",
  "PARTNER_LEFT",
  "TASTE_UPDATED",
  "MEMORY_ADDED",
  "MEMORY_UPDATED",
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
  const service = createServiceClient();
  const client = supabase ?? service;
  if (!client) return;

  const entityId = input.entityId ?? "";
  const latest = await client
    .from("activities")
    .select("id, action, actor_user_id, entity_type, entity_id, created_at")
    .eq("couple_id", input.coupleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = latest.data;
  const sameStory = row
    && row.action === input.action
    && row.actor_user_id === input.actorUserId
    && row.entity_type === input.entityType
    && row.entity_id === entityId
    && Date.now() - new Date(row.created_at).getTime() < 30 * 60 * 1000;

  const payload = {
    title: input.title,
    detail: input.detail ?? "",
    before_value: input.beforeValue ?? null,
    after_value: input.afterValue ?? null,
  };

  if (sameStory) {
    const updated = await client.from("activities").update(payload).eq("id", row.id).eq("couple_id", input.coupleId).select("id");
    if (!updated.error && updated.data?.length) return;
    if (service && client !== service) {
      const retry = await service.from("activities").update(payload).eq("id", row.id).eq("couple_id", input.coupleId).select("id");
      if (!retry.error && retry.data?.length) return;
    }
  }

  const inserted = await client.from("activities").insert({
    couple_id: input.coupleId,
    actor_user_id: input.actorUserId,
    entity_type: input.entityType,
    entity_id: entityId,
    action: input.action,
    ...payload,
  }).select("id");
  if (!inserted.error && inserted.data?.length) return;
  if (service && client !== service) {
    await service.from("activities").insert({
      couple_id: input.coupleId,
      actor_user_id: input.actorUserId,
      entity_type: input.entityType,
      entity_id: entityId,
      action: input.action,
      ...payload,
    });
  }
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

export async function dismissCoupleActivity(id: string) {
  return dismissCoupleActivities([id]);
}

export async function dismissCoupleActivities(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { ok: true as const };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  const service = createServiceClient();
  const scopedDelete = async (client: NonNullable<typeof supabase> | NonNullable<typeof service>) => {
    const result = await client.from("activities").delete().in("id", unique).eq("couple_id", session.coupleId).select("id");
    return Boolean(result.error) || !result.data?.length;
  };

  let failed = true;
  if (supabase) failed = await scopedDelete(supabase);
  if (failed && service) failed = await scopedDelete(service);
  if (failed) return { error: "이야기를 지우지 못했어요." };
  return { ok: true as const };
}

export async function clearCoupleActivities() {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  const service = createServiceClient();
  const scopedClear = async (client: NonNullable<typeof supabase> | NonNullable<typeof service>) => {
    const result = await client.from("activities").delete().eq("couple_id", session.coupleId).select("id");
    return Boolean(result.error) || !result.data?.length;
  };

  let failed = true;
  if (supabase) failed = await scopedClear(supabase);
  if (failed && service) failed = await scopedClear(service);
  if (failed) return { error: "이야기를 지우지 못했어요." };
  return { ok: true as const };
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
    .neq("entity_type", "date_draft")
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
