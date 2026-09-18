import type { CoupleActivity } from "./types";

export const IMPORTANT_ACTIONS = new Set([
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

export type ActivityRecord = {
  id: string;
  action: string;
  title: string;
  detail: string;
  actor_user_id: string | null;
  created_at: string;
};

export function relativeTime(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  return `${days}일 전`;
}

export function mapActivityRows(rows: ActivityRecord[], names: Map<string, string>, now = Date.now()): CoupleActivity[] {
  return rows.map(row => ({
    id: row.id,
    action: row.action,
    title: row.title,
    detail: row.detail,
    actorName: row.actor_user_id ? names.get(row.actor_user_id) ?? "파트너" : "시스템",
    actorUserId: row.actor_user_id,
    important: IMPORTANT_ACTIONS.has(row.action),
    createdAt: relativeTime(row.created_at, now),
  }));
}
