"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import type { Json } from "@/lib/supabase/database.types";
import { mergeBoardEdits } from "./mergeBoardEdits";
import { emptyBoardState, parseBoardState, type CorkBoardState } from "./corkLayout";

export async function loadMemoryWallBoard(): Promise<{ state: CorkBoardState | null; updatedAt: string | null }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { state: null, updatedAt: null };
  const supabase = await createClient();
  if (!supabase) return { state: null, updatedAt: null };
  const { data, error } = await supabase
    .from("memory_wall_boards")
    .select("state, updated_at")
    .eq("couple_id", session.coupleId)
    .maybeSingle();
  if (error) return { state: null, updatedAt: null };
  if (!data) return { state: null, updatedAt: null };
  const raw = typeof data.state === "string" ? data.state : JSON.stringify(data.state ?? {});
  const parsed = parseBoardState(raw);
  return { state: parsed, updatedAt: data.updated_at ?? null };
}

export async function saveMemoryWallBoard(state: CorkBoardState, base: CorkBoardState = state): Promise<{ ok: true; updatedAt: string; state: CorkBoardState } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 함께 벽면을 꾸밀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "저장 서버에 연결하지 못했어요." };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: current, error: readError } = await supabase.from("memory_wall_boards").select("state, updated_at").eq("couple_id", session.coupleId).maybeSingle();
    if (readError) return { error: readError.message };
    const remote = current ? parseBoardState(JSON.stringify(current.state)) ?? emptyBoardState() : emptyBoardState();
    const merged = current ? mergeBoardEdits(base, state, remote) : state;
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(current?.updated_at ?? "") + 1 || 0)).toISOString();
    const payload = { couple_id: session.coupleId, state: merged as unknown as Json, updated_by: session.userId, updated_at: updatedAt };
    const result = current
      ? await supabase.from("memory_wall_boards").update({ state: payload.state, updated_by: payload.updated_by, updated_at: payload.updated_at }).eq("couple_id", session.coupleId).eq("updated_at", current.updated_at).select("updated_at").maybeSingle()
      : await supabase.from("memory_wall_boards").insert(payload).select("updated_at").maybeSingle();
    if (result.error && result.error.code !== "23505") return { error: result.error.message };
    if (result.data) return { ok: true, updatedAt: result.data.updated_at, state: merged };
  }
  return { error: "서로의 변경을 맞추고 있어요. 잠시 후 다시 저장해 주세요." };
}
