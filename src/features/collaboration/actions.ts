"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import type { Json } from "@/lib/supabase/database.types";
import { mapActivityRows, type ActivityRecord } from "./activityMap";
import type { ActivityAction, CoupleActivity } from "./types";

type ActivityRow = ActivityRecord;

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
    if (result.error) return { failed: true, deleted: 0 };
    return { failed: false, deleted: result.data?.length ?? 0 };
  };

  let last = { failed: true, deleted: 0 };
  if (supabase) last = await scopedDelete(supabase);
  if ((last.failed || last.deleted === 0) && service) last = await scopedDelete(service);
  if (last.failed || (unique.length > 0 && last.deleted === 0)) return { error: "이야기를 지우지 못했어요." };
  return { ok: true as const };
}

export async function clearCoupleActivities() {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  const supabase = await createClient();
  const service = createServiceClient();
  const scopedClear = async (client: NonNullable<typeof supabase> | NonNullable<typeof service>) => {
    const result = await client.from("activities").delete().eq("couple_id", session.coupleId).select("id");
    if (result.error) return { failed: true as const };
    return { failed: false as const };
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

  const { data } = await supabase
    .from("activities")
    .select("id, action, title, detail, actor_user_id, created_at")
    .eq("couple_id", session.coupleId)
    .neq("entity_type", "date_draft")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as ActivityRow[];
  const names = await loadNames(rows.map(row => row.actor_user_id));
  return mapActivityRows(rows, names);
}
