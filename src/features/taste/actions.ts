"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withWorkspaceRead } from "@/lib/supabase/readContext";
import { listPlaces } from "@/features/places/actions";
import { cache } from "react";
import { getAppSession } from "@/features/auth/session";
import { queuePartnerEmail, recordCoupleActivity } from "@/features/collaboration/activityServer";
import { compareTasteProfiles, seedFromProfile } from "./compare";
import { parseTasteInput, parseTasteProfile } from "./parse";
import type { TasteBoard, TasteInput } from "./types";
import { createClient } from "@/lib/supabase/server";

function emptyBoard(youName = "나", partnerName = "파트너", partnerConnected = false): TasteBoard {
  return {
    you: null,
    partner: null,
    youName,
    partnerName,
    partnerConnected,
    compare: null,
  };
}

function rowToProfile(row: Record<string, unknown> | null | undefined) {
  return row ? parseTasteProfile(row) : null;
}

async function readTasteBoard(): Promise<TasteBoard> {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return emptyBoard();
  const youName = session.displayName;
  const partnerName = session.partner?.displayName ?? "파트너";
  const partnerConnected = Boolean(session.partner);
  const supabase = await createClient();
  if (!supabase) return emptyBoard(youName, partnerName, partnerConnected);

  const { data, error } = await supabase
    .from("taste_profiles")
    .select("user_id, areas, pace, activities, cuisines, avoid_foods, setting, crowd, time_window, area_scope, date_flow, drink, indoor_play, note")
    .eq("couple_id", session.coupleId);
  if (error) throw new Error("취향을 불러오지 못했어요. 기존 기준은 유지되니 잠시 후 다시 시도해 주세요.");

  const youRow = (data ?? []).find(row => row.user_id === session.userId);
  const partnerRow = session.partner
    ? (data ?? []).find(row => row.user_id === session.partner?.userId)
    : undefined;
  const you = rowToProfile(youRow as Record<string, unknown> | undefined);
  const partner = rowToProfile(partnerRow as Record<string, unknown> | undefined);
  return {
    you,
    partner,
    youName,
    partnerName,
    partnerConnected,
    compare: you && partner ? compareTasteProfiles(you, partner) : null,
  };
}

export const loadTasteBoard = cache(readTasteBoard);

export async function readTasteWorkspace() {
  return withWorkspaceRead(async () => {
    const [board, places] = await Promise.all([loadTasteBoard(), listPlaces()]);
    return { board, places: places.places };
  });
}

export async function saveTasteProfile(input: TasteInput, options?: {
  expectedSnapshot?: string;
  expectedScope?: { userId: string; coupleId: string };
}): Promise<TasteBoard | { error: string; conflict?: boolean }> {
  const parsed = parseTasteInput(input);
  if ("error" in parsed) return parsed;
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  if (options?.expectedScope && (options.expectedScope.userId !== session.userId || options.expectedScope.coupleId !== session.coupleId)) {
    return { error: "계정 또는 커플 공간이 변경됐어요. 최신 취향을 확인한 뒤 다시 저장해 주세요.", conflict: true };
  }
  const supabase = await createClient();
  if (!supabase) return { error: "저장 환경을 아직 준비하지 못했어요." };

  let previous: TasteBoard;
  try { previous = await readTasteBoard(); }
  catch { return { error: "기존 취향을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }; }
  const current = await supabase.from("taste_profiles").select("*")
    .eq("couple_id", session.coupleId).eq("user_id", session.userId).maybeSingle();
  if (current.error) return { error: "기존 취향을 확인하지 못했어요. 다시 저장해 주세요." };
  const savedProfile = rowToProfile(current.data);
  // A retry of the same committed content is safe, even after an uncertain response.
  if (JSON.stringify(savedProfile) === JSON.stringify(parsed)) {
    return { ...previous, you: parsed, compare: previous.partner ? compareTasteProfiles(parsed, previous.partner) : null };
  }
  if (options?.expectedSnapshot !== undefined) {
    let expected;
    try {
      if (typeof options.expectedSnapshot !== "string" || options.expectedSnapshot.length > 10000) throw new Error("invalid snapshot");
      const raw = JSON.parse(options.expectedSnapshot);
      expected = raw === null ? null : parseTasteProfile(raw);
      if (raw !== null && !expected) throw new Error("invalid snapshot");
    } catch { return { error: "편집을 시작한 취향을 확인하지 못했어요. 최신 기준을 다시 열어 주세요." }; }
    if (JSON.stringify(expected) !== JSON.stringify(savedProfile)) return {
      error: "다른 화면에서 내 취향이 변경됐어요. 최신 기준을 확인한 뒤 다시 저장해 주세요.", conflict: true,
    };
  }
  const payload = {
    couple_id: session.coupleId,
    user_id: session.userId,
    areas: parsed.areas,
    pace: parsed.pace,
    activities: parsed.activities,
    cuisines: parsed.cuisines,
    avoid_foods: parsed.avoidFoods,
    setting: parsed.setting,
    crowd: parsed.crowd,
    // The legacy database column is required; it no longer expresses user preferences.
    budget: "comfortable",
    time_window: parsed.timeWindow,
    area_scope: parsed.areaScope,
    date_flow: parsed.dateFlow,
    drink: parsed.drink,
    indoor_play: parsed.indoorPlay,
    note: parsed.note,
    updated_at: new Date(Math.max(Date.now(), (Date.parse(current.data?.updated_at ?? "") || 0) + 1)).toISOString(),
  };
  const { data, error } = current.data
    ? await supabase.from("taste_profiles").update(payload).eq("couple_id", session.coupleId)
      .eq("user_id", session.userId).eq("updated_at", current.data.updated_at).select("user_id").maybeSingle()
    : await supabase.from("taste_profiles").insert(payload).select("user_id").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) return {
    error: "다른 화면에서 내 취향을 먼저 저장했어요. 최신 기준을 확인해 주세요.", conflict: true,
  };
  if (error || !data) {
    return { error: "기준을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  after(async () => {
    const notifications: Promise<unknown>[] = [recordCoupleActivity({
      coupleId: session.coupleId,
      actorUserId: session.userId,
      entityType: "taste_profile",
      entityId: session.userId,
      action: "TASTE_UPDATED",
      title: "데이트 기준을 남겼어요",
      detail: `${session.displayName}님이 동네와 페이스를 업데이트했어요`,
    })];
    if (session.partner) {
      notifications.push(queuePartnerEmail({
        coupleId: session.coupleId,
        actorUserId: session.userId,
        partnerUserId: session.partner.userId,
        subject: "[ONLY US] 데이트 기준을 남겼어요",
        body: `${session.displayName}님이 우리의 데이트 기준을 업데이트했어요. 취향 화면에서 비교를 볼 수 있어요.`,
      }));
    }
    // Notifications cannot undo a committed profile or hold its response.
    await Promise.allSettled(notifications);
  });
  revalidatePath("/insights");
  revalidatePath("/date");
  revalidatePath("/");
  try { return await readTasteBoard(); }
  catch { return { ...previous, you: parsed, compare: previous.partner ? compareTasteProfiles(parsed, previous.partner) : null }; }
}

export async function loadTasteSeed() {
  const board = await loadTasteBoard();
  if (board.compare?.seed) return board.compare.seed;
  if (board.you) return seedFromProfile(board.you);
  return null;
}
