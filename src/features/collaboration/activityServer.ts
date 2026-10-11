import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { ActivityAction } from "./types";

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
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const service = createServiceClient();
  const client = supabase ?? service;
  if (!client) return { error: "활동 기록을 저장하지 못했어요." };

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
    if (!updated.error && updated.data?.length) return { ok: true as const };
    if (service && client !== service) {
      const retry = await service.from("activities").update(payload).eq("id", row.id).eq("couple_id", input.coupleId).select("id");
      if (!retry.error && retry.data?.length) return { ok: true as const };
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
  if (!inserted.error && inserted.data?.length) return { ok: true as const };
  if (service && client !== service) {
    const retry = await service.from("activities").insert({
      couple_id: input.coupleId,
      actor_user_id: input.actorUserId,
      entity_type: input.entityType,
      entity_id: entityId,
      action: input.action,
      ...payload,
    }).select("id");
    if (!retry.error && retry.data?.length) return { ok: true as const };
  }
  return { error: "활동 기록을 저장하지 못했어요. 다시 시도해 주세요." };
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

