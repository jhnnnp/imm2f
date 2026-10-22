"use server";

import { getAppSession } from "@/features/auth/session";
import { deleteMemory, updateMemory } from "@/features/memories/actions";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trip records share their metadata with Memories. Keep the itinerary/date
 * snapshot intact and reuse the existing atomic, conflict-checked memory edit. */
export async function updateArchivedTripPlan(input: {
  id: string; title: string; notes: string; expected: { title: string; notes: string };
}): Promise<{ ok: true; title: string; notes: string } | { error: string; conflict?: boolean }> {
  if (!input || typeof input.id !== "string" || !UUID.test(input.id) || typeof input.title !== "string" || !input.title.trim()
    || input.title.trim().length > 500 || typeof input.notes !== "string" || input.notes.length > 20000
    || !input.expected || typeof input.expected.title !== "string" || typeof input.expected.notes !== "string"
    || input.expected.title.length > 500 || input.expected.notes.length > 20000) return { error: "여행 제목과 메모를 확인해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 여행기록을 수정할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "여행기록 저장에 연결하지 못했어요." };
  const { data: memory, error } = await supabase.from("memories")
    .select("id,title,happened_on,description,location_label,memory_type,lng,lat")
    .eq("id", input.id).eq("couple_id", session.coupleId).eq("memory_type", "trip").maybeSingle();
  if (error) return { error: "여행기록을 확인하지 못했어요. 다시 시도해 주세요." };
  if (!memory) return { error: "이 여행기록을 찾을 수 없어요. 최신 목록을 확인해 주세요.", conflict: true };
  const title = input.title.trim();
  const notes = input.notes.trim();
  if (memory.title === title && memory.description === notes) return { ok: true, title, notes };
  if (memory.title !== input.expected.title || (memory.description ?? "") !== input.expected.notes) {
    return { error: "파트너가 이 여행기록을 수정했어요. 최신 기록을 확인하고 다시 수정해 주세요.", conflict: true };
  }
  const result = await updateMemory({ id: input.id, attemptId: crypto.randomUUID(),
    expectedSnapshot: JSON.stringify([memory.title, memory.happened_on, memory.description,
      memory.location_label, memory.memory_type, memory.lng == null || memory.lat == null ? null : [memory.lng, memory.lat]]),
    title, description: notes, happenedOn: memory.happened_on, locationLabel: memory.location_label,
    memoryType: "trip", lng: memory.lng, lat: memory.lat });
  if ("error" in result) return { error: result.error, conflict: result.conflict };
  return { ok: true, title: result.memory.title, notes: result.memory.description };
}

/** The existing memory deletion also removes its map entry and linked photos.
 * Require an authenticated couple-owned trip before entering that path. */
export async function deleteArchivedTripPlan(id: string): Promise<{ ok: true } | { error: string }> {
  if (typeof id !== "string" || !UUID.test(id)) return { error: "삭제할 여행기록을 다시 선택해 주세요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 여행기록을 삭제할 수 있어요." };
  const supabase = await createClient();
  if (!supabase) return { error: "여행기록 저장에 연결하지 못했어요." };
  const { data: memory, error } = await supabase.from("memories").select("id")
    .eq("id", id).eq("couple_id", session.coupleId).eq("memory_type", "trip").maybeSingle();
  if (error) return { error: "삭제할 여행기록을 확인하지 못했어요. 다시 시도해 주세요." };
  if (!memory) return { ok: true };
  return deleteMemory(id);
}
