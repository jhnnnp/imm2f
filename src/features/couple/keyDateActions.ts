"use server";

import { revalidatePath } from "next/cache";
import { getAppSession } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { emptyCoupleKeyDates, parseCoupleKeyDates, type CoupleKeyDatesSnapshot } from "./keyDates";
import type { Json } from "@/lib/supabase/database.types";

function missingSchema(error: { code?: string } | null) {
  return Boolean(error && ["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? ""));
}

export async function readCoupleKeyDates(): Promise<CoupleKeyDatesSnapshot> {
  const session = await getAppSession();
  const empty: CoupleKeyDatesSnapshot = { dates: emptyCoupleKeyDates(), revision: 0, onboardingCompleted: false, persist: false, scope: null };
  if (session.mode !== "authenticated") return empty;
  const scope = { coupleId: session.coupleId, userId: session.userId };
  const client = await createClient();
  if (!client) return { ...empty, scope };
  const result = await client.from("couple_key_dates").select("relationship_started_on,birthdays,revision,onboarding_completed")
    .eq("couple_id", session.coupleId).maybeSingle();
  if (missingSchema(result.error)) return { ...empty, scope };
  if (result.error) throw new Error("둘의 날짜를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!result.data) return { ...empty, persist: true, scope };
  const dates = parseCoupleKeyDates({ relationshipStartedOn: result.data.relationship_started_on, birthdays: result.data.birthdays });
  if (!dates || !Number.isSafeInteger(result.data.revision) || result.data.revision < 1)
    throw new Error("저장된 날짜를 확인하지 못했어요. 새로고침 후 다시 확인해 주세요.");
  return { dates, revision: result.data.revision, onboardingCompleted: result.data.onboarding_completed, persist: true, scope };
}

export async function saveCoupleKeyDates(input: {
  dates: unknown; expectedRevision: number; scope: { coupleId: string; userId: string }; onboardingCompleted?: boolean;
}): Promise<{ ok: true; snapshot: CoupleKeyDatesSnapshot } | { error: string; conflict?: boolean }> {
  const dates = parseCoupleKeyDates(input?.dates);
  if (!dates || !Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0
    || !input.scope || typeof input.scope.coupleId !== "string" || typeof input.scope.userId !== "string"
    || input.onboardingCompleted !== undefined && typeof input.onboardingCompleted !== "boolean")
    return { error: "날짜와 이름을 확인해 주세요. 생일은 두 명까지 입력할 수 있어요." };
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인 후 둘의 날짜를 남길 수 있어요." };
  if (input.scope.coupleId !== session.coupleId || input.scope.userId !== session.userId)
    return { error: "계정 또는 커플 공간이 바뀌었어요. 새로고침 후 다시 입력해 주세요.", conflict: true };
  const client = await createClient();
  if (!client) return { error: "저장 서버에 연결하지 못했어요. 입력 내용은 유지했어요." };
  const result = await client.rpc("save_couple_key_dates", {
    target_couple: session.coupleId, expected_revision: input.expectedRevision,
    started_on: dates.relationshipStartedOn, birthday_entries: dates.birthdays as unknown as Json,
    complete_onboarding: input.onboardingCompleted ?? true,
  }).maybeSingle();
  if (result.error?.message.includes("key dates conflict")) return { error: "파트너가 날짜를 먼저 수정했어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.", conflict: true };
  if (missingSchema(result.error)) return { error: "둘의 날짜 저장을 준비 중이에요. 입력 내용은 유지했어요." };
  if (result.error || !result.data) return { error: "둘의 날짜를 저장하지 못했어요. 입력 내용은 유지했으니 다시 시도해 주세요." };
  revalidatePath("/"); revalidatePath("/invite"); revalidatePath("/calendar");
  return { ok: true, snapshot: { dates, revision: result.data.revision, onboardingCompleted: result.data.onboarding_completed,
    persist: true, scope: { coupleId: session.coupleId, userId: session.userId } } };
}
