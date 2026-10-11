import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signUp } from "./session";

const mocks = vi.hoisted(() => ({
  signup: vi.fn(), signOut: vi.fn(), passwordSignin: vi.fn(), rpc: vi.fn(),
  createServiceClient: vi.fn(), clearDemo: vi.fn(), record: vi.fn(), queueEmail: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
  createClient: async () => ({
    auth: { signUp: mocks.signup, signOut: mocks.signOut, signInWithPassword: mocks.passwordSignin },
    rpc: mocks.rpc,
    from: (table: string) => ({ select: () => ({ eq: () => table === "couple_members"
      ? Promise.resolve({ data: [{ user_id: "new-user" }, { user_id: "partner" }] })
      : { maybeSingle: async () => ({ data: { display_name: "새로운 우리" } }) } }) }),
  }),
}));
vi.mock("./legacyDemoPlaces", () => ({ clearLegacyDemoPlaces: mocks.clearDemo }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.record, queuePartnerEmail: mocks.queueEmail }));

function form(invite?: string) {
  const data = new FormData();
  data.set("displayName", "우리"); data.set("email", "new@example.com"); data.set("password", "valid-password");
  if (invite) data.set("invite", invite);
  return data;
}
const token = "c9575c37973d4185973301a9e78ed0f16";
const sessionData = { user: { id: "new-user" }, session: { user: { id: "new-user" } } };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.signup.mockResolvedValue({ data: sessionData, error: null });
  mocks.rpc.mockResolvedValue({ data: "couple-id", error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://only-us.example");
});
afterEach(() => vi.unstubAllEnvs());

it("supports immediate sessions using native signup without admin creation or a second sign-in", async () => {
  await expect(signUp(null, form())).rejects.toThrow("REDIRECT:/");
  expect(mocks.signup).toHaveBeenCalledWith(expect.objectContaining({ options: { data: { display_name: "우리" }, emailRedirectTo: "https://only-us.example/auth/callback" } }));
  expect(mocks.rpc).toHaveBeenCalledWith("ensure_own_couple");
  expect(mocks.clearDemo).not.toHaveBeenCalled();
  expect(mocks.createServiceClient).not.toHaveBeenCalled();
  expect(mocks.passwordSignin).not.toHaveBeenCalled();
});

it("waits for email confirmation without authenticated writes and preserves the invitation callback", async () => {
  mocks.signup.mockResolvedValue({ data: { user: { id: "new-user" }, session: null }, error: null });
  const result = await signUp(null, form(token));
  expect(result?.message).toContain("이메일로 인증 링크");
  expect(result?.error).toBeUndefined();
  const callback = new URL(mocks.signup.mock.lastCall![0].options.emailRedirectTo);
  expect(callback.searchParams.get("next")).toBe(`/invite/${token}`);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("accepts an invitation immediately when the provider returns a session", async () => {
  await expect(signUp(null, form(token))).rejects.toThrow("REDIRECT:/");
  expect(mocks.rpc).toHaveBeenCalledWith("accept_couple_invite", { invite_token: token });
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ coupleId: "couple-id", actorUserId: "new-user", action: "PARTNER_JOINED" }));
  expect(mocks.queueEmail).toHaveBeenCalledTimes(1);
});

it("reports provider email throttling without attempting setup", async () => {
  mocks.signup.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Email rate limit exceeded", status: 429 } });
  expect((await signUp(null, form()))?.error).toContain("잠시 기다린 뒤");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("preserves a newly created account when its invitation has expired", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "invite expired" } });
  const result = await signUp(null, form(token));
  expect(result?.error).toContain("계정은 만들어졌어요");
  expect(result?.error).toContain("만료");
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(mocks.createServiceClient).not.toHaveBeenCalled();
});

it("preserves a newly created account when workspace setup needs a retry", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "network failed" } });
  expect((await signUp(null, form()))?.error).toContain("로그인해서 다시 시도");
  expect(mocks.createServiceClient).not.toHaveBeenCalled();
});

it("validates malformed invitations before contacting the auth provider", async () => {
  expect((await signUp(null, form("invalid")))?.error).toContain("초대 링크가 올바르지");
  expect(mocks.signup).not.toHaveBeenCalled();
});
