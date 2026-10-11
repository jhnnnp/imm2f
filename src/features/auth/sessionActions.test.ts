import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptCoupleInvite, leaveCouple, signIn, signOut, signUp } from "./session";
import { withWorkspaceRead } from "@/lib/supabase/readContext";

const mocks = vi.hoisted(() => ({
  claims: vi.fn(), password: vi.fn(), signup: vi.fn(), signOut: vi.fn(), rpc: vi.fn(),
  members: vi.fn(), profile: vi.fn(), ownInvite: vi.fn(), from: vi.fn(), service: vi.fn(),
  activity: vi.fn(), email: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.service,
  createClient: async () => ({
    auth: { getClaims: mocks.claims, signInWithPassword: mocks.password, signUp: mocks.signup, signOut: mocks.signOut },
    rpc: mocks.rpc, from: mocks.from,
  }),
}));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity, queuePartnerEmail: mocks.email }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));

const token = "c9575c37973d4185973301a9e78ed0f16";
function form(invite?: string) {
  const value = new FormData();
  value.set("displayName", "우리"); value.set("email", "user@example.com"); value.set("password", "valid-password");
  if (invite) { value.set("invite", invite); value.set("next", `/invite/${invite}`); }
  return value;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
  mocks.password.mockResolvedValue({ data: {}, error: null });
  mocks.signup.mockResolvedValue({ data: { user: { id: "user-1" }, session: { user: { id: "user-1" } } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation((name: string) => name === "app_session_snapshot"
    ? { maybeSingle: async () => ({ data: { couple_id: "couple-1", display_name: "우리", partner_user_id: "partner-1", partner_display_name: "파트너" }, error: null }) }
    : Promise.resolve({ data: "couple-1", error: null }));
  mocks.members.mockResolvedValue({ data: [{ user_id: "user-1" }, { user_id: "partner-1" }], error: null });
  mocks.profile.mockResolvedValue({ data: { display_name: "우리" }, error: null });
  mocks.ownInvite.mockResolvedValue({ data: { inviter_id: "partner-1" }, error: null });
  mocks.activity.mockResolvedValue({ ok: true });
  mocks.email.mockResolvedValue(undefined);
  mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => table === "couple_members"
    ? mocks.members()
    : { maybeSingle: table === "couple_invites" ? mocks.ownInvite : mocks.profile } }) }));
});
afterEach(() => vi.restoreAllMocks());

it("keeps manually saved places intact when signing in", async () => {
  await expect(signIn(null, form())).rejects.toThrow("REDIRECT:/");
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalledWith("places");
  expect(mocks.rpc).toHaveBeenCalledWith("ensure_own_couple");
});

it("does not run privileged place cleanup when creating a new account", async () => {
  await expect(signUp(null, form())).rejects.toThrow("REDIRECT:/");
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalledWith("places");
});

it("preserves a committed invitation when the subsequent membership read fails", async () => {
  mocks.members.mockResolvedValue({ data: null, error: { message: "Provider unavailable" } });
  await expect(acceptCoupleInvite(token)).rejects.toThrow("REDIRECT:/");
  expect(mocks.rpc).toHaveBeenCalledWith("accept_couple_invite", { invite_token: token });
  expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  expect(mocks.email).not.toHaveBeenCalled();
});

it("preserves a committed invitation when the subsequent membership request throws", async () => {
  mocks.members.mockRejectedValue(new Error("Connection lost"));
  await expect(acceptCoupleInvite(token)).rejects.toThrow("REDIRECT:/");
  expect(mocks.revalidate).toHaveBeenCalledTimes(1);
});

it("attempts the email independently and finishes joining when activity recording rejects", async () => {
  mocks.activity.mockRejectedValue(new Error("Activity unavailable"));
  await expect(acceptCoupleInvite(token)).rejects.toThrow("REDIRECT:/");
  expect(mocks.email).toHaveBeenCalledTimes(1);
  expect(mocks.revalidate).toHaveBeenCalledTimes(1);
});

it("finishes joining when a notification returns an error or the email rejects", async () => {
  mocks.activity.mockResolvedValue({ error: "활동 기록을 저장하지 못했어요" });
  mocks.email.mockRejectedValue(new Error("Outbox unavailable"));
  await expect(acceptCoupleInvite(token)).rejects.toThrow("REDIRECT:/");
  expect(mocks.activity).toHaveBeenCalledTimes(1);
  expect(mocks.email).toHaveBeenCalledTimes(1);
});

it("finishes invitation signup even when post-commit notifications fail", async () => {
  mocks.members.mockRejectedValue(new Error("Connection lost"));
  await expect(signUp(null, form(token))).rejects.toThrow("REDIRECT:/");
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("finishes invitation login even when post-commit notifications fail", async () => {
  mocks.activity.mockRejectedValue(new Error("Connection lost"));
  await expect(signIn(null, form(token))).rejects.toThrow("REDIRECT:/");
  expect(mocks.rpc).not.toHaveBeenCalledWith("ensure_own_couple");
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("does not report a connection when the invitation RPC returns no couple", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect(await acceptCoupleInvite(token)).toMatchObject({ error: expect.stringContaining("연결되지") });
  expect(mocks.activity).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("explains that an invitation stopped to preserve a solo space's saved records", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "solo workspace has saved data" } });
  const result = await acceptCoupleInvite(token);
  expect(result?.error).toContain("저장된 기록");
  expect(result?.error).toContain("그대로 보존");
  expect(mocks.activity).not.toHaveBeenCalled();
});

it("reports an empty setup result and clears only the attempted login session", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect((await signIn(null, form()))?.error).toContain("계정 공간");
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("does not revoke another device's session when login verification fails", async () => {
  mocks.claims.mockResolvedValue({ data: null, error: { message: "Invalid claims" } });
  expect((await signIn(null, form()))?.error).toContain("로그인 정보를 확인");
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});

it("signs out the current session without signing out other devices", async () => {
  await expect(signOut()).rejects.toThrow("REDIRECT:/login");
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});

it("refuses a non-transactional fallback when the disconnect RPC is missing", async () => {
  mocks.rpc.mockImplementation((name: string) => name === "app_session_snapshot"
    ? { maybeSingle: async () => ({ data: { couple_id: "couple-1", display_name: "우리", partner_user_id: "partner-1", partner_display_name: "파트너" }, error: null }) }
    : Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find function leave_couple" } }));
  expect((await withWorkspaceRead(() => leaveCouple()))?.error).toContain("연결 해제를 아직 준비");
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("redirects only after an atomic disconnect returns its resulting space", async () => {
  await expect(withWorkspaceRead(() => leaveCouple())).rejects.toThrow("REDIRECT:/invite");
  expect(mocks.rpc).toHaveBeenCalledWith("leave_couple");
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalledWith("my_couple_id");
  expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
});

it("does not pretend a disconnect completed when its RPC result is empty", async () => {
  mocks.rpc.mockImplementation((name: string) => name === "app_session_snapshot"
    ? { maybeSingle: async () => ({ data: { couple_id: "couple-1", display_name: "우리", partner_user_id: "partner-1", partner_display_name: "파트너" }, error: null }) }
    : Promise.resolve({ data: null, error: null }));
  expect((await withWorkspaceRead(() => leaveCouple()))?.error).toContain("연결 해제를 확인");
  expect(mocks.revalidate).not.toHaveBeenCalled();
  expect(mocks.service).not.toHaveBeenCalled();
});
