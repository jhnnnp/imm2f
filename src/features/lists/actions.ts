"use server";

import { revalidatePath } from "next/cache";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import { recordCoupleActivity } from "@/features/collaboration/activityServer";
import type { CoupleNote, NoteKind } from "./types";
import { NOTE_STATUS } from "./types";
import { isNoteCreationAttemptId, type NoteCreationInput } from "./noteCreationAttempt";

function validKind(kind: NoteKind) {
  return typeof kind === "string" && Object.hasOwn(NOTE_STATUS, kind);
}

const NOTE_LIMITS = { title: 140, detail: 4000, extra: 4096 };
function validNoteId(value: unknown) { return typeof value === "string" && Boolean(value.trim()) && value.length <= 128; }
function validVersion(value: unknown) { return value === undefined || (typeof value === "string" && Boolean(value.trim()) && value.length <= 64); }
function validText(value: unknown, max: number) { return typeof value === "string" && value.length <= max; }

function refreshNotes(kind: NoteKind) {
  revalidatePath(kind === "gift" ? "/gifts" : `/${kind}`);
  revalidatePath("/");
}

async function recordNoteChange(session: Extract<Awaited<ReturnType<typeof getAppSession>>, { mode: "authenticated" }>, kind: NoteKind, detail: string, entityId?: string) {
  try {
    await recordCoupleActivity({ coupleId: session.coupleId, actorUserId: session.userId, entityType: "note", entityId,
      action: kind === "vault" ? "VAULT_UPDATED" : kind === "gift" ? "GIFT_UPDATED" : "BUCKET_UPDATED",
      title: kind === "vault" ? "보관함을 정리했어요" : kind === "gift" ? "선물 목록을 정리했어요" : "버킷리스트를 정리했어요", detail });
  } catch {
    // The note mutation has already committed; an optional feed failure must
    // not keep a deleted item in the UI or prompt a second successful write.
  }
}

type NoteRow = {
  id: string;
  kind: NoteKind;
  title: string;
  detail: string;
  status: string;
  extra: string;
  created_at: string;
  created_by: string;
  updated_at?: string;
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
    updatedAt: row.updated_at,
  };
}

const loadNotes = cache(async (kind: NoteKind): Promise<{ persist: boolean; notes: CoupleNote[] }> => {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { persist: false, notes: [] };
  const supabase = await createClient();
  if (!supabase) return { persist: false, notes: [] };
  const { data, error } = await supabase
    .from("couple_notes")
    .select("id, kind, title, detail, status, extra, created_at, created_by, updated_at")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error("목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!data) return { persist: true, notes: [] };
  return { persist: true, notes: data.map(row => toNote(row as NoteRow)) };
});

export async function listNotes(kind: NoteKind) {
  if (!validKind(kind)) throw new Error("목록을 확인해 주세요.");
  return loadNotes(kind);
}

export async function createNotesBatch(
  kind: NoteKind,
  items: ReadonlyArray<NoteCreationInput>,
): Promise<{ notes: CoupleNote[] } | { error: string }> {
  if (!validKind(kind) || !Array.isArray(items) || items.length > 100) return { error: "저장할 목록을 확인해 주세요." };
  if (!items.length) return { notes: [] };
  if (items.some(item => !item || typeof item.title !== "string" || !item.title.trim() || typeof item.detail !== "string" || typeof item.extra !== "string")) return { error: "모든 항목에 제목을 입력해 주세요." };
  if (items.some(item => !validText(item.title, NOTE_LIMITS.title) || !validText(item.detail, NOTE_LIMITS.detail) || !validText(item.extra, NOTE_LIMITS.extra))) {
    return { error: "제목은 140자, 메모는 4,000자, 코드·링크는 4,096자 이하로 입력해 주세요." };
  }
  if (items.some(item => item.status !== undefined && !NOTE_STATUS[kind].some(status => status.id === item.status))) return { error: "항목의 상태를 확인해 주세요." };
  const attempts = items.map(item => item.attemptId);
  const retryable = attempts.some(id => id !== undefined);
  if (retryable && (attempts.some(id => !isNoteCreationAttemptId(id)) || new Set(attempts).size !== items.length)) return { error: "저장 요청을 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 남길 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "저장 환경을 준비하지 못했어요." };
  const { data: firstRow, error: loadError } = await supabase.from("couple_notes").select("sort_order").eq("couple_id", session.coupleId).eq("kind", kind).order("sort_order", { ascending: true }).limit(1).maybeSingle();
  if (loadError) return { error: "목록을 확인하지 못했어요. 다시 시도해 주세요." };
  const firstOrder = (firstRow?.sort_order ?? 0) - items.length;
  const payload = items.map((item, index) => ({
    ...(retryable ? { id: item.attemptId } : {}),
    couple_id: session.coupleId,
    kind,
    title: item.title.trim(),
    detail: item.detail.trim(),
    extra: item.extra.trim(),
    status: NOTE_STATUS[kind].some(status => status.id === item.status) ? item.status! : NOTE_STATUS[kind][0].id,
    sort_order: firstOrder + index,
    created_by: session.userId,
  }));
  const table = supabase.from("couple_notes");
  // DO NOTHING on a repeated identity: a retry must never overwrite a partner's edits.
  const write = retryable ? table.upsert(payload, { onConflict: "id", ignoreDuplicates: true }) : table.insert(payload);
  const { data, error } = await write.select("id, kind, title, detail, status, extra, created_at, created_by, updated_at");
  let saved = data;
  if (retryable && (error || data?.length !== items.length)) {
    const existing = await supabase.from("couple_notes")
      .select("id, kind, title, detail, status, extra, created_at, created_by, updated_at")
      .eq("couple_id", session.coupleId).eq("kind", kind).eq("created_by", session.userId).in("id", attempts as string[]);
    if (existing.error || existing.data?.length !== items.length) return { error: "목록 저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요." };
    const byId = new Map(existing.data.map(row => [row.id, row]));
    saved = attempts.map(id => byId.get(id!)!);
  }
  if (!saved || (!retryable && error)) return { error: "목록을 저장하지 못했어요. 다시 시도해 주세요." };
  if (data?.length) await recordCoupleActivity({ coupleId: session.coupleId, actorUserId: session.userId, entityType: "note", entityId: data[0].id, action: kind === "vault" ? "VAULT_UPDATED" : kind === "gift" ? "GIFT_UPDATED" : "BUCKET_UPDATED", title: "우리의 목록에 남겼어요", detail: `${data.length}개 항목` }).catch(() => undefined);
  refreshNotes(kind);
  return { notes: saved.map(row => toNote(row as NoteRow)) };
}

export async function createNote(kind: NoteKind, input: NoteCreationInput): Promise<{ note: CoupleNote } | { error: string }> {
  const result = await createNotesBatch(kind, [input]);
  if ("error" in result) return result;
  return { note: result.notes[0] };
}

export async function reorderNotes(kind: NoteKind, orderedIds: string[]): Promise<{ ok: true } | { error: string }> {
  if (!validKind(kind) || !Array.isArray(orderedIds) || orderedIds.some(id => !validNoteId(id)) || orderedIds.length > 500
    || new Set(orderedIds).size !== orderedIds.length) return { error: "순서를 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 순서를 바꿀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const uniqueIds = [...new Set(orderedIds)];
  if (!uniqueIds.length) return { ok: true };
  const { data: rows, error: readError } = await supabase
    .from("couple_notes")
    .select("id")
    .eq("couple_id", session.coupleId)
    .eq("kind", kind)
    .in("id", uniqueIds);
  if (readError || !rows || rows.length !== uniqueIds.length) return { error: "목록이 변경됐어요. 최신 내용을 확인한 뒤 다시 정렬해 주세요." };
  const attempts = await Promise.allSettled(uniqueIds.map((id, index) =>
    supabase
      .from("couple_notes")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("couple_id", session.coupleId)
      .eq("kind", kind)
      .select("id")
      .maybeSingle(),
  ));
  const results = attempts.flatMap(attempt => attempt.status === "fulfilled" ? [attempt.value] : []);
  const failed = results.length !== attempts.length || results.some(result => result.error || !result.data);
  // The legacy schema has no reorder transaction. Announce successful writes even
  // after a partial failure, so the partner and retry read the actual saved order.
  if (results.some(result => result.data)) await recordNoteChange(session, kind, "목록 순서를 바꿨어요");
  refreshNotes(kind);
  if (failed) return { error: "일부 순서를 저장하지 못했어요. 최신 목록을 다시 불러온 뒤 정렬해 주세요." };
  return { ok: true };
}

export async function updateNoteContent(
  id: string,
  patch: { title?: string; detail?: string; extra?: string },
  expectedUpdatedAt?: string,
): Promise<{ note: CoupleNote } | { error: string }> {
  if (!validNoteId(id) || !validVersion(expectedUpdatedAt) || !patch || typeof patch !== "object" || Array.isArray(patch)) return { error: "수정할 항목을 확인해 주세요." };
  if ((patch.title !== undefined && !validText(patch.title, NOTE_LIMITS.title))
    || (patch.detail !== undefined && !validText(patch.detail, NOTE_LIMITS.detail))
    || (patch.extra !== undefined && !validText(patch.extra, NOTE_LIMITS.extra))) {
    return { error: "제목은 140자, 메모는 4,000자, 코드·링크는 4,096자 이하로 입력해 주세요." };
  }
  if (patch.title !== undefined && !patch.title.trim()) return { error: "제목을 입력해 주세요." };
  if (patch.title === undefined && patch.detail === undefined && patch.extra === undefined) return { error: "바꿀 내용이 없어요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 수정할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const updates: { title?: string; detail?: string; extra?: string } = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { error: "제목을 입력해 주세요." };
    updates.title = title;
  }
  if (patch.detail !== undefined) updates.detail = patch.detail.trim();
  if (patch.extra !== undefined) updates.extra = patch.extra.trim();
  if (!Object.keys(updates).length) return { error: "바꿀 내용이 없어요." };
  let update = supabase.from("couple_notes").update(updates).eq("id", id).eq("couple_id", session.coupleId);
  if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await update.select("id, kind, title, detail, status, extra, created_at, created_by, updated_at").maybeSingle();
  if (!error && !data) return { error: "파트너가 이 항목을 수정하거나 삭제했어요. 최신 내용을 확인해 주세요." };
  if (error || !data) return { error: "수정 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  await recordNoteChange(session, data.kind as NoteKind, data.title, id);
  refreshNotes(data.kind as NoteKind);
  return { note: toNote(data as NoteRow) };
}

export async function updateNoteStatus(id: string, status: string, expectedUpdatedAt?: string): Promise<{ ok: true; note: CoupleNote } | { error: string }> {
  if (!validNoteId(id) || !validVersion(expectedUpdatedAt) || typeof status !== "string"
    || !Object.values(NOTE_STATUS).some(options => options.some(option => option.id === status))) return { error: "항목과 상태를 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 바꿀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const current = await supabase.from("couple_notes").select("kind").eq("id", id).eq("couple_id", session.coupleId).maybeSingle();
  const kind = current.data?.kind as NoteKind;
  if (current.error || !current.data) return { error: "바꿀 항목을 찾지 못했어요." };
  if (!validKind(kind) || !NOTE_STATUS[kind].some(item => item.id === status)) return { error: "상태를 확인해 주세요." };
  let update = supabase.from("couple_notes").update({ status }).eq("id", id).eq("couple_id", session.coupleId);
  if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await update.select("id, kind, title, detail, status, extra, created_at, created_by, updated_at").maybeSingle();
  if (error || !data) return { error: "파트너가 이 항목을 수정하거나 삭제했어요. 최신 내용을 확인하고 다시 바꿔 주세요." };
  await recordNoteChange(session, kind, data.title, id);
  refreshNotes(kind);
  return { ok: true, note: toNote(data as NoteRow) };
}

export async function deleteNote(id: string): Promise<{ ok: true } | { error: string }> {
  if (!validNoteId(id)) return { error: "삭제할 항목을 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 지울 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const { data, error } = await supabase
    .from("couple_notes")
    .delete()
    .eq("id", id)
    .eq("couple_id", session.coupleId)
    .select("kind")
    .maybeSingle();
  if (error) return { error: "항목을 삭제하지 못했어요. 다시 시도해 주세요." };
  if (data) {
    await recordNoteChange(session, data.kind as NoteKind, "항목을 지웠어요", id);
    refreshNotes(data.kind as NoteKind);
  }
  else for (const kind of ["vault", "gift", "bucket"] as const) refreshNotes(kind);
  return { ok: true };
}
