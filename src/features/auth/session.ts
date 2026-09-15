"use server";

import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { AppSession } from "./types";

function safeNextPath(value: FormDataEntryValue | string | null) {
  const path = String(value ?? "/");
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function authErrorMessage(message: string) {
  if (message.toLowerCase().includes("invalid login")) return "이메일 또는 비밀번호가 올바르지 않아요.";
  if (message.toLowerCase().includes("already registered")) return "이미 가입된 이메일이에요.";
  if (message.toLowerCase().includes("email not confirmed")) return "이메일 인증을 먼저 완료해 주세요.";
  return message;
}

export async function getAppSession(): Promise<AppSession> {
  if (!isSupabaseConfigured()) return { mode: "prototype" };
  const supabase = await createClient();
  if (!supabase) return { mode: "guest" };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") return { mode: "guest" };

  const { data: coupleId, error: coupleError } = await supabase.rpc("ensure_own_couple");
  if (coupleError || !coupleId) return { mode: "guest" };

  const [{ data: profile }, { data: members }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("id", userId).maybeSingle(),
    supabase.from("couple_members").select("user_id, role").eq("couple_id", coupleId),
  ]);

  const memberIds = (members ?? []).map(member => member.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", memberIds)
    : { data: [] as Array<{ id: string; display_name: string }> };

  const partnerRow = (profiles ?? []).find(item => item.id !== userId);

  return {
    mode: "authenticated",
    userId,
    displayName: profile?.display_name || "나",
    coupleId,
    partner: partnerRow ? { userId: partnerRow.id, displayName: partnerRow.display_name || "파트너" } : null,
  };
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "이메일과 비밀번호를 입력해 주세요." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authErrorMessage(error.message) };

  await supabase.rpc("ensure_own_couple");
  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const inviteToken = String(formData.get("invite") ?? "").trim();
  if (!displayName || !email || password.length < 8) {
    return { error: "이름, 이메일, 8자 이상 비밀번호가 필요해요." };
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";
  const service = createServiceClient();
  if (service) {
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (created.error) return { error: authErrorMessage(created.error.message) };
  } else {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });
    if (error) return { error: authErrorMessage(error.message) };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) return { error: authErrorMessage(signInError.message) };

  if (inviteToken) {
    const { error: inviteError } = await supabase.rpc("accept_couple_invite", { invite_token: inviteToken });
    if (inviteError) return { error: inviteError.message };
  } else {
    const { error: coupleError } = await supabase.rpc("ensure_own_couple");
    if (coupleError) return { error: coupleError.message };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
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

export async function acceptCoupleInvite(token: string) {
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase 환경 변수가 아직 없어요." };

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId || typeof userId !== "string") return { error: "로그인이 필요해요." };

  const { data: coupleId, error } = await supabase.rpc("accept_couple_invite", { invite_token: token });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already in a couple")) return { error: "이미 다른 파트너와 연결되어 있어요." };
    if (message.includes("expired")) return { error: "초대 링크가 만료됐어요." };
    if (message.includes("not found")) return { error: "초대 링크를 찾지 못했어요." };
    return { error: error.message };
  }

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  const displayName = profile?.display_name || "파트너";
  if (coupleId) {
    const { recordCoupleActivity, queuePartnerEmail } = await import("@/features/collaboration/actions");
    await recordCoupleActivity({
      coupleId: String(coupleId),
      actorUserId: userId,
      entityType: "couple",
      entityId: String(coupleId),
      action: "PARTNER_JOINED",
      title: "파트너가 연결됐어요",
      detail: `${displayName}님이 초대에 응했어요`,
    });
    const members = await supabase.from("couple_members").select("user_id").eq("couple_id", String(coupleId));
    const partnerId = (members.data ?? []).map(row => row.user_id).find(id => id !== userId) ?? null;
    await queuePartnerEmail({
      coupleId: String(coupleId),
      actorUserId: userId,
      partnerUserId: partnerId,
      subject: "[ONLY US] 파트너가 연결됐어요",
      body: `${displayName}님이 초대 링크를 수락했어요.`,
    });
  }
  redirect("/");
}
