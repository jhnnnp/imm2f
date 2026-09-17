"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { recordCoupleActivity } from "@/features/collaboration/actions";
import type { CoupleNote, NoteKind } from "./types";
import { NOTE_STATUS } from "./types";

type NoteRow = {
  id: string;
  kind: NoteKind;
  title: string;
  detail: string;
  status: string;
  extra: string;
  created_at: string;
  created_by: string;
};

function toNote(row: NoteRow): CoupleNote {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    extra: row.extra,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function listNotes(kind: NoteKind): Promise<{ persist: boolean; notes: CoupleNote[] }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, notes: [] };
  const supabase = await createClient();
  if (!supabase) return { persist: false, notes: [] };
  const { data } = await supabase
    .from("couple_notes")
    .select("id, kind, title, detail, status, extra, created_at, created_by")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (!data) return { persist: true, notes: [] };
  return { persist: true, notes: data.map(row => toNote(row as NoteRow)) };
}

export async function createNote(kind: NoteKind, input: { title: string; detail: string; extra: string; status: string }): Promise<{ note: CoupleNote } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 남길 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const title = input.title.trim();
  if (!title) return { error: "제목을 입력해 주세요." };
  const allowed = NOTE_STATUS[kind].some(item => item.id === input.status) ? input.status : NOTE_STATUS[kind][0].id;
  const { data, error } = await supabase
    .from("couple_notes")
    .insert({
      couple_id: session.coupleId,
      kind,
      title,
      detail: input.detail.trim(),
      extra: input.extra.trim(),
      status: allowed,
      created_by: session.userId,
    })
    .select("id, kind, title, detail, status, extra, created_at, created_by")
    .single();
  if (error || !data) return { error: error?.message ?? "저장하지 못했어요." };
  const action = kind === "vault" ? "VAULT_UPDATED" : kind === "gift" ? "GIFT_UPDATED" : "BUCKET_UPDATED";
  await recordCoupleActivity({
    coupleId: session.coupleId,
    actorUserId: session.userId,
    entityType: "note",
    entityId: data.id,
    action,
    title: kind === "vault" ? "보관함에 남겼어요" : kind === "gift" ? "선물 계획을 남겼어요" : "버킷리스트를 남겼어요",
    detail: title,
  });
  return { note: toNote(data as NoteRow) };
}

export async function updateNoteStatus(id: string, status: string): Promise<{ ok: true } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 바꿀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const { error } = await supabase
    .from("couple_notes")
    .update({ status })
    .eq("id", id)
    .eq("couple_id", session.coupleId);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteNote(id: string): Promise<{ ok: true } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 지울 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const { error } = await supabase
    .from("couple_notes")
    .delete()
    .eq("id", id)
    .eq("couple_id", session.coupleId);
  if (error) return { error: error.message };
  return { ok: true };
}
