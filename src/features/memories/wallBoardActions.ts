"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/features/auth/session";
import type { Json } from "@/lib/supabase/database.types";
import { parseBoardState, type CorkBoardState } from "./corkLayout";

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
  if (error || !data) return { state: null, updatedAt: null };
  const raw = typeof data.state === "string" ? data.state : JSON.stringify(data.state ?? {});
  const parsed = parseBoardState(raw);
  return { state: parsed, updatedAt: data.updated_at ?? null };
}

export async function saveMemoryWallBoard(state: CorkBoardState): Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 함께 벽면을 꾸밀 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const payload = {
    couple_id: session.coupleId,
    state: state as unknown as Json,
    updated_by: session.userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("memory_wall_boards")
    .upsert(payload, { onConflict: "couple_id" })
    .select("updated_at")
    .single();
  if (error || !data) return { error: error?.message ?? "벽면을 저장하지 못했어요." };
  return { ok: true, updatedAt: data.updated_at ?? payload.updated_at };
}
