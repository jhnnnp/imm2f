"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getWorkspaceReadContext } from "@/lib/supabase/readContext";
import { inviteTokenFromPath, isInviteToken } from "./invitePath";
import { displayNameOf } from "./koreanName";
import { safeNextPath } from "./redirectPath";
import { signupEmailRedirect } from "./signupRedirect";
import type { AppSession } from "./types";

function authErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login")) return "이메일 또는 비밀번호가 올바르지 않아요.";
  if (normalized.includes("already registered") || normalized.includes("already been registered")) return "이미 가입된 이메일이에요.";
  if (normalized.includes("email not confirmed")) return "이메일 인증을 먼저 완료해 주세요.";
  if (normalized.includes("rate limit") || normalized.includes("too many requests") || normalized.includes("too many emails")) return "요청이 많아요. 잠시 기다린 뒤 다시 시도해 주세요.";
  if (normalized.includes("invite not found")) return "초대 링크를 찾지 못했어요.";
  if (normalized.includes("invite expired")) return "초대 링크가 만료됐어요.";
  if (normalized.includes("solo workspace has saved data")) return "내 공간에 저장된 기록이 있어 연결을 진행하지 않았어요. 기존 기록은 그대로 보존돼요.";
  if (normalized.includes("already in a couple")) return "이미 다른 파트너와 연결되어 있어요.";
  if (normalized.includes("couple already has two members")) return "이미 연결이 완료된 초대예요.";
  if (normalized.includes("own invite")) return "이건 내가 만든 초대예요. 파트너에게 링크를 전해 주세요.";
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

function isMissingLeaveFunction(message: string, code?: string) {
  const normalized = message.toLowerCase();
  return (
    code === "PGRST202"
    || code === "42883"
    || (normalized.includes("could not find") && normalized.includes("function"))
  );
}

function refreshSessionUI() {
  // Authentication is read in the workspace layout. Purge the client router cache so
  // the layout receives the newly written (or deleted) Supabase session cookie.
  revalidatePath("/", "layout");
}

const loadAppSession = cache(async (): Promise<AppSession> => {
  if (!isSupabaseConfigured()) return { mode: "guest" };
  const startedAt = performance.now();
  const supabase = await createClient();
  if (!supabase) return { mode: "guest" };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError && (claimsError.name === "AuthRetryableFetchError" || claimsError.name === "AuthUnknownError" || (claimsError.status ?? 0) >= 500)) {
    throw new Error("로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") return { mode: "guest" };
  const claimsDoneAt = performance.now();

  const { data: snapshot, error: snapshotError } = await supabase.rpc("app_session_snapshot").maybeSingle();
  if (snapshotError && snapshotError.code !== "PGRST202" && snapshotError.code !== "42883") {
    // An outage is not an absent couple. Do not turn a failed read into setup
    // writes and several more network requests against the same failing service.
    throw new Error("계정 공간을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  if (!snapshotError && snapshot?.couple_id) {
    if (process.env.PERF_DEBUG === "1") console.info("app_session_timing", JSON.stringify({
      path: "snapshot", claimsMs: Math.round(claimsDoneAt - startedAt), databaseMs: Math.round(performance.now() - claimsDoneAt),
    }));
    return {
      mode: "authenticated",
      userId,
      displayName: displayNameOf(snapshot.display_name, "나"),
      coupleId: snapshot.couple_id,
      partner: snapshot.partner_user_id
        ? { userId: snapshot.partner_user_id, displayName: displayNameOf(snapshot.partner_display_name) }
        : null,
    };
  }

  // Older databases and new users without a couple still use the setup path.
  const [{ data: profile, error: profileError }, { data: existingCoupleId, error: coupleReadError }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("id", userId).maybeSingle(),
    supabase.rpc("my_couple_id"),
  ]);
  if (profileError || coupleReadError) throw new Error("계정 공간을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");

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
  }

  const { data: members, error: membersError } = await supabase.from("couple_members").select("user_id, role").eq("couple_id", coupleId);
  if (membersError) throw new Error("파트너 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
  const partnerId = (members ?? []).find(member => member.user_id !== userId)?.user_id;
  const { data: partnerRow, error: partnerError } = partnerId
    ? await supabase.from("profiles").select("id, display_name").eq("id", partnerId).maybeSingle()
    : { data: null, error: null };
  if (partnerError) throw new Error("파트너 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");

  if (process.env.PERF_DEBUG === "1") console.info("app_session_timing", JSON.stringify({
    path: "fallback", claimsMs: Math.round(claimsDoneAt - startedAt), databaseMs: Math.round(performance.now() - claimsDoneAt),
  }));

  return {
    mode: "authenticated",
    userId,
    displayName: displayNameOf(profile?.display_name, "나"),
    coupleId,
    partner: partnerRow ? { userId: partnerRow.id, displayName: displayNameOf(partnerRow.display_name) } : null,
  };
});

export async function getAppSession(): Promise<AppSession> {
  const read = getWorkspaceReadContext();
  if (read) return read.session ??= loadAppSession();
  return loadAppSession();
}

export type AuthActionState = { error?: string; message?: string } | null;

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
    await supabase.auth.signOut({ scope: "local" });
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

  const { data: ownCoupleId, error: coupleError } = await supabase.rpc("ensure_own_couple");
  if (coupleError || !ownCoupleId) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "계정 공간을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
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
  if (inviteToken && !isInviteToken(inviteToken)) return { error: "초대 링크가 올바르지 않아요. 새로운 링크를 요청해 주세요." };
  if (!displayName || !email || password.length < 8) {
    return { error: "이름, 이메일, 8자 이상 비밀번호가 필요해요." };
  }

  const emailRedirectTo = signupEmailRedirect(inviteToken);
  const created = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, ...(emailRedirectTo ? { emailRedirectTo } : {}) },
  });
  if (created.error) {
    return { error: authErrorMessage(created.error?.message ?? "계정을 만들지 못했어요.") };
  }
  // Respect the provider's confirmation policy and preserve the PKCE cookie.
  // No authenticated RPC is attempted until an actual session is issued.
  if (!created.data.session) {
    return { message: "이메일로 인증 링크를 보냈어요. 받은 편지함과 스팸함을 확인하고, 인증을 완료한 뒤 로그인해 주세요." };
  }
  const createdUserId = created.data.user?.id ?? created.data.session.user.id;

  if (inviteToken) {
    const { data: coupleId, error: inviteError } = await supabase.rpc("accept_couple_invite", { invite_token: inviteToken });
    if (inviteError || !coupleId) {
      await supabase.auth.signOut({ scope: "local" });
      return { error: `계정은 만들어졌어요. ${authErrorMessage(inviteError?.message ?? "invite failed")} 로그인한 뒤 초대 링크를 다시 열어 주세요.` };
    }
    if (coupleId) await recordPartnerJoined(supabase, String(coupleId), createdUserId);
  } else {
    const { data: ownCoupleId, error: coupleError } = await supabase.rpc("ensure_own_couple");
    if (coupleError || !ownCoupleId) {
      await supabase.auth.signOut({ scope: "local" });
      return { error: "계정은 만들어졌지만 공간을 준비하지 못했어요. 잠시 후 로그인해서 다시 시도해 주세요." };
    }
  }

  refreshSessionUI();
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  refreshSessionUI();
  redirect("/login");
}

export async function createCoupleInvite() {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };
  const { data, error } = await supabase.rpc("create_couple_invite");
  if (error) return { error: authErrorMessage(error.message) };
  const payload = data as { token?: string; expires_at?: string } | null;
  if (!payload?.token) return { error: "초대 링크를 만들지 못했어요." };
  return { token: payload.token, expiresAt: payload.expires_at ?? null };
}

export async function getInvitePreview(token: string) {
  if (!isInviteToken(token)) return { valid: false as const, reason: "not_found" };
  const supabase = await createClient();
  if (!supabase) return { valid: false as const, reason: "not_configured" };
  const { data, error } = await supabase.rpc("get_invite_preview", { invite_token: token });
  if (error) throw new Error("초대 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  if (!data) return { valid: false as const, reason: "not_found" };
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
  // The membership transaction has already committed. A failed notification
  // must not report a failed invitation or make the user retry a consumed link.
  try {
    const members = await supabase.from("couple_members").select("user_id").eq("couple_id", coupleId);
    if (members.error) throw members.error;
    const partnerId = (members.data ?? []).map(row => row.user_id).find(id => id !== userId) ?? null;

    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    const displayName = displayNameOf(profile?.display_name);
    const { recordCoupleActivity, queuePartnerEmail } = await import("@/features/collaboration/activityServer");
    const notifications = await Promise.allSettled([
      recordCoupleActivity({
        coupleId,
        actorUserId: userId,
        entityType: "couple",
        entityId: coupleId,
        action: "PARTNER_JOINED",
        title: "파트너가 연결됐어요",
        detail: `${displayName}님이 초대를 수락했어요`,
      }),
      queuePartnerEmail({
        coupleId,
        actorUserId: userId,
        partnerUserId: partnerId,
        subject: "[ONLY US] 파트너가 연결됐어요",
        body: `${displayName}님이 초대 링크를 수락했어요.`,
      }),
    ]);
    for (const result of notifications) {
      if (result.status === "rejected") console.error("Failed to notify a completed partner connection", result.reason);
      else if (result.value && "error" in result.value) console.error("Failed to record a completed partner connection", result.value.error);
    }
  } catch (error) {
    console.error("Failed to notify a completed partner connection", error);
  }
}

export async function acceptCoupleInvite(token: string) {
  if (!isInviteToken(token)) return { error: "초대 링크가 올바르지 않아요. 새로운 링크를 요청해 주세요." };
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
    return { error: authErrorMessage(error.message) };
  }

  if (!coupleId) {
    return { error: "파트너와 연결되지 않았어요. 초대한 사람에게 새 링크를 요청해 주세요." };
  }
  await recordPartnerJoined(supabase, String(coupleId), userId);
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

export async function leaveCouple() {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return { error: "로그인이 필요해요." };
  if (!session.partner) return { error: "연결된 파트너가 없어요." };

  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data: newCoupleId, error } = await supabase.rpc("leave_couple");
  if (error) {
    if (isMissingLeaveFunction(error.message, error.code)) return { error: "연결 해제를 아직 준비하지 못했어요. 잠시 후 다시 시도해 주세요." };
    return { error: authErrorMessage(error.message) };
  }
  if (!newCoupleId) return { error: "연결 해제를 확인하지 못했어요. 다시 시도해 주세요." };

  refreshSessionUI();
  redirect("/invite");
}
