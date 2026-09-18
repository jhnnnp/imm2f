"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { inviteTokenFromPath } from "./invitePath";
import { displayNameOf } from "./koreanName";
import { clearLegacyDemoPlaces } from "./legacyDemoPlaces";
import type { AppSession } from "./types";

function safeNextPath(value: FormDataEntryValue | string | null) {
  const path = String(value ?? "/");
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function authErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login")) return "이메일 또는 비밀번호가 올바르지 않아요.";
  if (normalized.includes("already registered") || normalized.includes("already been registered")) return "이미 가입된 이메일이에요.";
  if (normalized.includes("email not confirmed")) return "이메일 인증을 먼저 완료해 주세요.";
  if (normalized.includes("invite not found")) return "초대 링크를 찾지 못했어요.";
  if (normalized.includes("invite expired")) return "초대 링크가 만료됐어요.";
  if (normalized.includes("already in a couple")) return "이미 다른 파트너와 연결되어 있어요.";
  if (normalized.includes("couple already has two members")) return "이미 연결이 완료된 초대예요.";
  if (normalized.includes("own invite")) return "이건 내가 만든 초대예요. 파트너에게 링크를 전해 주세요.";
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function isMissingLeaveFunction(message: string, code?: string) {
  const normalized = message.toLowerCase();
  return (
    code === "PGRST202"
    || normalized.includes("leave_couple")
    || (normalized.includes("could not find") && normalized.includes("function"))
  );
}

function refreshSessionUI() {
  // Authentication is read in the root layout. Purge the client router cache so
  // the layout receives the newly written (or deleted) Supabase session cookie.
  revalidatePath("/", "layout");
}

const loadAppSession = cache(async (): Promise<AppSession> => {
  if (!isSupabaseConfigured()) return { mode: "guest" };
  const supabase = await createClient();
  if (!supabase) return { mode: "guest" };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") return { mode: "guest" };

  const [{ data: profile }, { data: existingCoupleId }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("id", userId).maybeSingle(),
    supabase.rpc("my_couple_id"),
  ]);

  let coupleId = existingCoupleId;
  if (!coupleId) {
    const ensured = await supabase.rpc("ensure_own_couple");
    coupleId = ensured.data;
    if (ensured.error || !coupleId) {
      console.error("Failed to initialize the authenticated user's space", ensured.error);
      return {
        mode: "setup_error",
        userId,
        displayName: displayNameOf(profile?.display_name, "나"),
      };
    }
    await clearLegacyDemoPlaces(String(coupleId));
  }

  const { data: members } = await supabase.from("couple_members").select("user_id, role").eq("couple_id", coupleId);
  const partnerId = (members ?? []).find(member => member.user_id !== userId)?.user_id;
  const { data: partnerRow } = partnerId
    ? await supabase.from("profiles").select("id, display_name").eq("id", partnerId).maybeSingle()
    : { data: null };

  return {
    mode: "authenticated",
    userId,
    displayName: displayNameOf(profile?.display_name, "나"),
    coupleId,
    partner: partnerRow ? { userId: partnerRow.id, displayName: displayNameOf(partnerRow.display_name) } : null,
  };
});

export async function getAppSession(): Promise<AppSession> {
  return loadAppSession();
}

export type AuthActionState = { error: string } | null;

export async function signIn(_previousState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "이메일과 비밀번호를 입력해 주세요." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authErrorMessage(error.message) };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") {
    await supabase.auth.signOut();
    return { error: "로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  const nextPath = safeNextPath(formData.get("next"));
  const inviteToken = inviteTokenFromPath(nextPath);
  if (inviteToken && !(await isOwnCoupleInvite(inviteToken, userId))) {
    const { data: coupleId, error: inviteError } = await supabase.rpc("accept_couple_invite", { invite_token: inviteToken });
    if (!inviteError && coupleId) {
      await recordPartnerJoined(supabase, String(coupleId), userId);
      refreshSessionUI();
      redirect("/");
    }
  }

  const { error: coupleError } = await supabase.rpc("ensure_own_couple");
  if (coupleError) {
    await supabase.auth.signOut();
    return { error: "계정 공간을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  await clearLegacyDemoPlaces();
  refreshSessionUI();
  redirect(nextPath);
}

export async function signUp(_previousState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const inviteToken = String(formData.get("invite") ?? "").trim();
  if (!displayName || !email || password.length < 8) {
    return { error: "이름, 이메일, 8자 이상 비밀번호가 필요해요." };
  }

  const service = createServiceClient();
  if (!service) return { error: "즉시 가입에 필요한 Supabase 서버 키가 설정되지 않았어요." };
  const adminService = service;

  const created = await adminService.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created.error || !created.data.user) {
    return { error: authErrorMessage(created.error?.message ?? "계정을 만들지 못했어요.") };
  }
  const createdUserId = created.data.user.id;

  async function rollbackCreatedUser() {
    const { error } = await adminService.auth.admin.deleteUser(createdUserId);
    if (error) console.error("Failed to roll back incomplete signup", error);
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    await rollbackCreatedUser();
    return { error: authErrorMessage(signInError.message) };
  }

  if (inviteToken) {
    const { data: coupleId, error: inviteError } = await supabase.rpc("accept_couple_invite", { invite_token: inviteToken });
    if (inviteError) {
      await supabase.auth.signOut();
      await rollbackCreatedUser();
      return { error: authErrorMessage(inviteError.message) };
    }
    if (coupleId) await recordPartnerJoined(supabase, String(coupleId), createdUserId);
  } else {
    const { error: coupleError } = await supabase.rpc("ensure_own_couple");
    if (coupleError) {
      await supabase.auth.signOut();
      await rollbackCreatedUser();
      return { error: "계정 공간을 준비하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
    await clearLegacyDemoPlaces();
  }

  refreshSessionUI();
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  refreshSessionUI();
  redirect("/login");
}

export async function createCoupleInvite() {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const { data, error } = await supabase.rpc("create_couple_invite");
  if (error) return { error: error.message };
  const payload = data as { token?: string; expires_at?: string } | null;
  if (!payload?.token) return { error: "초대 링크를 만들지 못했어요." };
  return { token: payload.token, expiresAt: payload.expires_at ?? null };
}

export async function getInvitePreview(token: string) {
  const supabase = await createClient();
  if (!supabase) return { valid: false as const, reason: "not_configured" };
  const { data, error } = await supabase.rpc("get_invite_preview", { invite_token: token });
  if (error || !data) return { valid: false as const, reason: "not_found" };
  const payload = data as { valid?: boolean; reason?: string; inviter_name?: string; expires_at?: string };
  if (!payload.valid) return { valid: false as const, reason: payload.reason ?? "expired" };
  return { valid: true as const, inviterName: payload.inviter_name ?? "파트너", expiresAt: payload.expires_at ?? null };
}

export async function isOwnCoupleInvite(token: string, userId: string) {
  const supabase = await createClient();
  if (!supabase) return false;
  const { data } = await supabase.from("couple_invites").select("inviter_id").eq("token", token).maybeSingle();
  return data?.inviter_id === userId;
}

async function recordPartnerJoined(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  coupleId: string,
  userId: string,
) {
  const members = await supabase.from("couple_members").select("user_id").eq("couple_id", coupleId);
  const partnerId = (members.data ?? []).map(row => row.user_id).find(id => id !== userId) ?? null;
  if (!partnerId) return false;

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const displayName = displayNameOf(profile?.display_name);
  const { recordCoupleActivity, queuePartnerEmail } = await import("@/features/collaboration/actions");
  await recordCoupleActivity({
    coupleId,
    actorUserId: userId,
    entityType: "couple",
    entityId: coupleId,
    action: "PARTNER_JOINED",
    title: "파트너가 연결됐어요",
    detail: `${displayName}님이 초대를 수락했어요`,
  });
  await queuePartnerEmail({
    coupleId,
    actorUserId: userId,
    partnerUserId: partnerId,
    subject: "[ONLY US] 파트너가 연결됐어요",
    body: `${displayName}님이 초대 링크를 수락했어요.`,
  });
  return true;
}

export async function acceptCoupleInvite(token: string) {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") return { error: "로그인이 필요해요." };

  if (await isOwnCoupleInvite(token, userId)) {
    return { error: "이건 내가 만든 초대예요. 파트너에게 링크를 전해 주세요." };
  }

  const { data: coupleId, error } = await supabase.rpc("accept_couple_invite", { invite_token: token });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already in a couple")) return { error: "이미 다른 파트너와 연결되어 있어요." };
    if (message.includes("expired")) return { error: "초대 링크가 만료됐어요." };
    if (message.includes("not found")) return { error: "초대 링크를 찾지 못했어요." };
    if (message.includes("own invite")) return { error: "이건 내가 만든 초대예요. 파트너에게 링크를 전해 주세요." };
    return { error: error.message };
  }

  const joined = coupleId ? await recordPartnerJoined(supabase, String(coupleId), userId) : false;
  if (!joined) {
    return { error: "파트너와 연결되지 않았어요. 초대한 사람에게 새 링크를 요청해 주세요." };
  }
  refreshSessionUI();
  redirect("/");
}

export async function getCoupleConnection() {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { session, connectedAt: null as string | null };
  const supabase = await createClient();
  if (!supabase) return { session, connectedAt: null as string | null };
  const { data: members } = await supabase
    .from("couple_members")
    .select("user_id, joined_at")
    .eq("couple_id", session.coupleId);
  const dates = (members ?? []).map(row => row.joined_at).filter(Boolean).sort();
  const latest = session.partner ? dates.at(-1) ?? null : null;
  return { session, connectedAt: latest };
}

async function leaveCoupleWithService(session: Extract<AppSession, { mode: "authenticated" }>) {
  const service = createServiceClient();
  const supabase = await createClient();
  if (!service || !supabase) return { error: "연결 해제를 아직 준비하지 못했어요. 잠시 후 다시 시도해 주세요." };

  const { data: members } = await service
    .from("couple_members")
    .select("user_id")
    .eq("couple_id", session.coupleId);
  const partnerId = (members ?? []).map(row => row.user_id).find(id => id !== session.userId);
  if (!partnerId) return { error: "연결된 파트너가 없어요." };

  const { error: activityError } = await service.from("activities").insert({
    couple_id: session.coupleId,
    actor_user_id: session.userId,
    entity_type: "couple",
    entity_id: session.coupleId,
    action: "PARTNER_LEFT",
    title: "파트너 연결이 해제됐어요",
    detail: `${session.displayName}님이 공간에서 나갔어요`,
  });
  if (activityError) console.error("Failed to record partner leave", activityError);

  const { error: emailError } = await service.from("email_outbox").insert({
    couple_id: session.coupleId,
    recipient_user_id: partnerId,
    subject: "[ONLY US] 파트너 연결이 해제됐어요",
    body: `${session.displayName}님이 연결을 해제하고 공간에서 나갔어요.`,
    status: "queued",
  });
  if (emailError) console.error("Failed to queue partner leave email", emailError);

  const { error: deleteError } = await service
    .from("couple_members")
    .delete()
    .eq("user_id", session.userId)
    .eq("couple_id", session.coupleId);
  if (deleteError) return { error: authErrorMessage(deleteError.message) };

  await service
    .from("couple_invites")
    .update({ status: "revoked" })
    .eq("couple_id", session.coupleId)
    .eq("status", "pending");

  const { error: ensureError } = await supabase.rpc("ensure_own_couple");
  if (ensureError) return { error: "빈 공간을 만들지 못했어요. 다시 로그인해 주세요." };

  const { data: newCoupleId } = await supabase.rpc("my_couple_id");
  if (newCoupleId) await clearLegacyDemoPlaces(String(newCoupleId));
  return null;
}

export async function leaveCouple() {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  if (!session.partner) return { error: "연결된 파트너가 없어요." };

  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { error } = await supabase.rpc("leave_couple");
  if (error && !isMissingLeaveFunction(error.message, error.code)) {
    return { error: authErrorMessage(error.message) };
  }
  if (error) {
    const fallback = await leaveCoupleWithService(session);
    if (fallback?.error) return fallback;
  } else {
    const { data: newCoupleId } = await supabase.rpc("my_couple_id");
    if (newCoupleId) await clearLegacyDemoPlaces(String(newCoupleId));
  }

  refreshSessionUI();
  redirect("/invite");
}
