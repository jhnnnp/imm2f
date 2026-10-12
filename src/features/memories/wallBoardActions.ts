"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import type { Json } from "@/lib/supabase/database.types";
import { mergeBoardEdits } from "./mergeBoardEdits";
import { emptyBoardState, type CorkBoardState } from "./corkLayout";
import { parseStoredWallBoard, validWallBoard } from "./boardValidation";

export async function loadMemoryWallBoard(): Promise<{ state: CorkBoardState | null; updatedAt: string | null }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { state: null, updatedAt: null };
  const supabase = await createClient();
  if (!supabase) return { state: null, updatedAt: null };
  const { data, error } = await supabase
    .from("memory_wall_boards")
    .select("state, updated_at, updated_by")
    .eq("couple_id", session.coupleId)
    .maybeSingle();
  if (error) throw new Error("벽면을 불러오지 못했어요. 현재 꾸민 내용은 그대로 있어요.");
  if (!data) return { state: null, updatedAt: null };
  const parsed = parseStoredWallBoard(data.state, data.updated_by === null);
  if (!parsed) throw new Error("벽면 정보를 확인하지 못했어요. 잠시 후 다시 불러와 주세요.");
  return { state: parsed, updatedAt: data.updated_at ?? null };
}

export async function saveMemoryWallBoard(state: CorkBoardState, base: CorkBoardState = state, expectedScope?: { coupleId: string; userId: string | null }): Promise<{ ok: true; updatedAt: string; state: CorkBoardState } | { error: string }> {
  if (!validWallBoard(state) || !validWallBoard(base)) return { error: "벽면의 필기나 배치 정보를 확인해 주세요. 현재 편집은 유지했어요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 함께 벽면을 꾸밀 수 있어요." };
  if (expectedScope && (expectedScope.coupleId !== session.coupleId || expectedScope.userId !== session.userId)) return { error: "계정 또는 커플 공간이 바뀌었어요. 이전 벽면은 저장하지 않았어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "저장 서버에 연결하지 못했어요." };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: current, error: readError } = await supabase.from("memory_wall_boards").select("state, updated_at, updated_by").eq("couple_id", session.coupleId).maybeSingle();
    if (readError) return { error: "벽면을 확인하지 못했어요. 연결을 확인하고 다시 저장해 주세요." };
    const remote = current ? parseStoredWallBoard(current.state, current.updated_by === null) : emptyBoardState();
    if (!remote) return { error: "기존 벽면 정보를 확인하지 못했어요. 다시 불러온 뒤 저장해 주세요." };
    const merged = current ? mergeBoardEdits(base, state, remote) : state;
    if (!validWallBoard(merged)) return { error: "함께 꾸민 벽면이 저장 가능한 크기를 넘었어요. 현재 편집을 유지했으니 필기를 정리한 뒤 다시 저장해 주세요." };
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(current?.updated_at ?? "") + 1 || 0)).toISOString();
    const payload = { couple_id: session.coupleId, state: merged as unknown as Json, updated_by: session.userId, updated_at: updatedAt };
    const result = current
      ? await supabase.from("memory_wall_boards").update({ state: payload.state, updated_by: payload.updated_by, updated_at: payload.updated_at }).eq("couple_id", session.coupleId).eq("updated_at", current.updated_at).select("updated_at").maybeSingle()
      : await supabase.from("memory_wall_boards").insert(payload).select("updated_at").maybeSingle();
    if (result.error && result.error.code !== "23505") return { error: "벽면을 저장하지 못했어요. 연결을 확인하고 다시 저장해 주세요." };
    if (result.data) return { ok: true, updatedAt: result.data.updated_at, state: merged };
  }
  return { error: "서로의 변경을 맞추고 있어요. 잠시 후 다시 저장해 주세요." };
}
