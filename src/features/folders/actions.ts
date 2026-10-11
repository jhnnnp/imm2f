"use server";

import { revalidatePath } from "next/cache";
import { getAppSession } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recordCoupleActivity } from "@/features/collaboration/activityServer";
import type { Database } from "@/lib/supabase/database.types";
import { validFolderId, validFolderInput, validFolderScope } from "./folderState";
import { EMPTY_FOLDER_WORKSPACE, type ArchiveFolder, type FolderScope, type FolderWorkspace } from "./types";

type FolderRow = Database["public"]["Tables"]["couple_folders"]["Row"];
function toFolder(row: FolderRow): ArchiveFolder {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at };
}
function validVersion(value: unknown) { return value === undefined || typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)); }
async function access() {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return null;
  const client = await createClient();
  return client ? { client, coupleId: session.coupleId, userId: session.userId } : null;
}
function refresh(scope: FolderScope) { revalidatePath(scope === "places" ? "/places" : "/vault"); }
async function announce(auth: NonNullable<Awaited<ReturnType<typeof access>>>, scope: FolderScope, detail: string) {
  // Activity events also announce deletes whose Realtime payload is reduced by RLS.
  await recordCoupleActivity({ coupleId: auth.coupleId, actorUserId: auth.userId, entityType: "folder",
    action: scope === "places" ? "PLACE_FOLDERS_UPDATED" : "VAULT_UPDATED", title: scope === "places" ? "장소 폴더를 정리했어요" : "보관함 폴더를 정리했어요", detail }).catch(() => undefined);
}

export async function listFolderWorkspace(scope: FolderScope): Promise<FolderWorkspace> {
  if (!validFolderScope(scope)) throw new Error("폴더 영역을 확인해 주세요.");
  const auth = await access();
  if (!auth) return EMPTY_FOLDER_WORKSPACE;
  const [folders, memberships] = await Promise.all([
    (async () => {
      const rows: FolderRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await auth.client.from("couple_folders").select("*").eq("couple_id", auth.coupleId).eq("scope", scope).order("id").range(offset, offset + 999);
        if (result.error) throw new Error("폴더를 불러오지 못했어요. 다시 시도해 주세요.");
        rows.push(...(result.data ?? []));
        if (!result.data || result.data.length < 1000) break;
      }
      return rows.map(toFolder).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    })(),
    (async () => {
      const rows: FolderWorkspace["memberships"] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await auth.client.from("couple_folder_items").select("item_id,folder_id,id").eq("couple_id", auth.coupleId).eq("scope", scope).order("id").range(offset, offset + 999);
        if (result.error) throw new Error("폴더의 내용을 불러오지 못했어요. 다시 시도해 주세요.");
        rows.push(...(result.data ?? []).map(row => ({ itemId: row.item_id, folderId: row.folder_id })));
        if (!result.data || result.data.length < 1000) break;
      }
      return rows;
    })(),
  ]);
  return { folders, memberships, persist: true };
}

export async function createFolder(scope: FolderScope, input: { name: string; color: ArchiveFolder["color"]; attemptId: string }): Promise<{ folder: ArchiveFolder } | { error: string }> {
  if (!validFolderScope(scope) || !validFolderInput(input) || !validFolderId(input.attemptId)) return { error: "폴더 이름은 1~40자로 입력하고 색상을 골라 주세요." };
  const auth = await access();
  if (!auth) return { error: "로그인 후 폴더를 만들 수 있어요." };
  const result = await auth.client.from("couple_folders").insert({ id: input.attemptId, couple_id: auth.coupleId, scope, name: input.name.trim(), color: input.color }).select("*").single();
  if (result.error || !result.data) {
    // Retrying a lost response must preserve any subsequent partner rename.
    const previous = await auth.client.from("couple_folders").select("*").eq("id", input.attemptId).eq("couple_id", auth.coupleId).eq("scope", scope).maybeSingle();
    if (!previous.error && previous.data) { refresh(scope); return { folder: toFolder(previous.data) }; }
    return { error: result.error?.code === "23505" ? "같은 이름의 폴더가 있어요. 다른 이름을 입력해 주세요." : "폴더를 만들지 못했어요. 다시 시도해 주세요." };
  }
  refresh(scope);
  await announce(auth, scope, "새 폴더를 만들었어요");
  return { folder: toFolder(result.data) };
}

export async function renameFolder(scope: FolderScope, id: string, input: { name: string; color: ArchiveFolder["color"] }, expectedUpdatedAt?: string): Promise<{ folder: ArchiveFolder } | { error: string }> {
  if (!validFolderScope(scope) || !validFolderId(id) || !validFolderInput(input) || !validVersion(expectedUpdatedAt)) return { error: "폴더 이름과 색상을 확인해 주세요." };
  const auth = await access();
  if (!auth) return { error: "로그인 후 폴더를 바꿀 수 있어요." };
  let query = auth.client.from("couple_folders").update({ name: input.name.trim(), color: input.color }).eq("id", id).eq("couple_id", auth.coupleId).eq("scope", scope);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const result = await query.select("*").maybeSingle();
  if (result.error) return { error: result.error.code === "23505" ? "같은 이름의 폴더가 있어요. 다른 이름을 입력해 주세요." : "폴더를 수정하지 못했어요. 다시 시도해 주세요." };
  if (!result.data) return { error: "파트너가 폴더를 변경했어요. 최신 내용을 확인해 주세요." };
  refresh(scope);
  await announce(auth, scope, "폴더 이름과 색상을 바꿨어요");
  return { folder: toFolder(result.data) };
}

export async function deleteFolder(scope: FolderScope, id: string, expectedUpdatedAt?: string): Promise<{ ok: true } | { error: string }> {
  if (!validFolderScope(scope) || !validFolderId(id) || !validVersion(expectedUpdatedAt)) return { error: "삭제할 폴더를 확인해 주세요." };
  const auth = await access();
  if (!auth) return { error: "로그인 후 폴더를 정리할 수 있어요." };
  let query = auth.client.from("couple_folders").delete().eq("id", id).eq("couple_id", auth.coupleId).eq("scope", scope);
  if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
  const result = await query.select("id").maybeSingle();
  if (result.error) return { error: "폴더를 삭제하지 못했어요. 다시 시도해 주세요." };
  if (!result.data) return { error: "폴더가 변경되거나 삭제됐어요. 최신 내용을 확인해 주세요." };
  refresh(scope);
  await announce(auth, scope, "폴더를 지웠어요. 안의 항목은 미분류에 남아 있어요");
  return { ok: true };
}

export async function moveFolderItems(scope: FolderScope, itemIds: string[], folderId: string | null): Promise<{ ok: true } | { error: string }> {
  if (!validFolderScope(scope) || !Array.isArray(itemIds) || !itemIds.length || itemIds.length > 500 || itemIds.some(id => !validFolderId(id)) || folderId !== null && !validFolderId(folderId)) return { error: "이동할 항목과 폴더를 확인해 주세요. 한 번에 500개까지 이동할 수 있어요." };
  const auth = await access();
  if (!auth) return { error: "로그인 후 폴더로 이동할 수 있어요." };
  const ids = [...new Set(itemIds)];
  const result = await auth.client.rpc("move_couple_folder_items", { p_scope: scope, p_item_ids: ids, p_folder_id: folderId });
  if (result.error || result.data !== ids.length) return { error: "폴더나 항목이 변경됐어요. 최신 내용을 확인한 뒤 다시 이동해 주세요." };
  refresh(scope);
  await announce(auth, scope, `${ids.length}개 항목을 ${folderId ? "폴더에" : "미분류로"} 옮겼어요`);
  return { ok: true };
}
