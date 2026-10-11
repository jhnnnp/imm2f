import { beforeEach, expect, it, vi } from "vitest";
import { getAppSession, getInvitePreview } from "./session";
import { withWorkspaceRead } from "@/lib/supabase/readContext";

const { getClaims, snapshot, rpc, from } = vi.hoisted(() => ({ getClaims: vi.fn(), snapshot: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims }, rpc, from }), createServiceClient: () => null }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  snapshot.mockReset().mockResolvedValue({ data: { couple_id: "couple-1", display_name: "우리", partner_user_id: null }, error: null });
  rpc.mockReset().mockReturnValue({ maybeSingle: snapshot });
  from.mockReset();
});

function oldDatabase(coupleId: string | null = "couple-1") {
  snapshot.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing snapshot function" } });
  rpc.mockImplementation(name => name === "app_session_snapshot" ? { maybeSingle: snapshot } : Promise.resolve({ data: coupleId, error: null }));
}

it("does not mistake a profile outage for an account needing new setup", async () => {
  oldDatabase(null);
  from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "503" } }) }) }) });
  await expect(withWorkspaceRead(() => getAppSession())).rejects.toThrow("계정 공간을 확인하지 못했어요");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["app_session_snapshot", "my_couple_id"]);
});

it("preserves membership as an error rather than reporting a disconnected partner", async () => {
  oldDatabase();
  from.mockImplementation(table => ({ select: () => ({ eq: () => table === "profiles"
    ? { maybeSingle: async () => ({ data: { display_name: "나" }, error: null }) }
    : Promise.resolve({ data: null, error: { code: "503" } }) }) }));
  await expect(withWorkspaceRead(() => getAppSession())).rejects.toThrow("파트너 연결을 확인하지 못했어요");
});

it("keeps a failed partner profile read distinct from an absent partner", async () => {
  oldDatabase();
  from.mockImplementation(table => ({ select: () => ({ eq: (_column: string, id: string) => table === "profiles"
    ? { maybeSingle: async () => id === "user-1" ? { data: { display_name: "나" }, error: null } : { data: null, error: { code: "503" } } }
    : Promise.resolve({ data: [{ user_id: "user-1" }, { user_id: "partner-1" }], error: null }) }) }));
  await expect(withWorkspaceRead(() => getAppSession())).rejects.toThrow("파트너 정보를 확인하지 못했어요");
});

it("supports an older database without duplicating an existing couple", async () => {
  oldDatabase();
  from.mockImplementation(table => ({ select: () => ({ eq: (_column: string, id: string) => table === "profiles"
    ? { maybeSingle: async () => ({ data: { id, display_name: id === "user-1" ? "나" : "상대" }, error: null }) }
    : Promise.resolve({ data: [{ user_id: "user-1" }, { user_id: "partner-1" }], error: null }) }) }));
  expect(await withWorkspaceRead(() => getAppSession())).toMatchObject({ mode: "authenticated", coupleId: "couple-1", partner: { userId: "partner-1", displayName: "상대" } });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["app_session_snapshot", "my_couple_id"]);
});

it("does not label a temporary invitation provider failure as an expired invite", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "503" } });
  await expect(getInvitePreview("c9575c37973d4185973301a9e78ed0f16")).rejects.toThrow("초대 정보를 불러오지 못했어요");
});

it("shares one verified session for concurrent reads in one workspace action", async () => {
  const sessions = await withWorkspaceRead(() => Promise.all([getAppSession(), getAppSession(), getAppSession(), getAppSession()]));
  expect(sessions).toHaveLength(4);
  expect(sessions[0]).toMatchObject({ mode: "authenticated", coupleId: "couple-1" });
  expect(getClaims).toHaveBeenCalledTimes(1);
  expect(snapshot).toHaveBeenCalledTimes(1);
  await withWorkspaceRead(() => getAppSession());
  expect(getClaims).toHaveBeenCalledTimes(2);
});

it("does not turn a provider failure into setup writes or an empty account", async () => {
  snapshot.mockResolvedValue({ data: null, error: { code: "503", message: "Provider unavailable" } });
  await expect(withWorkspaceRead(() => getAppSession())).rejects.toThrow("계정 공간을 불러오지 못했어요");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["app_session_snapshot"]);
});

it("keeps a temporary authentication outage distinct from a signed-out session", async () => {
  getClaims.mockResolvedValue({ data: null, error: { name: "AuthRetryableFetchError", status: 503 } });
  await expect(withWorkspaceRead(() => getAppSession())).rejects.toThrow("로그인 정보를 확인하지 못했어요");
  expect(rpc).not.toHaveBeenCalled();
});

it("isolates concurrent workspace reads belonging to different users", async () => {
  let releaseFirst: () => void = () => {};
  getClaims.mockImplementationOnce(() => new Promise(resolve => {
    releaseFirst = () => resolve({ data: { claims: { sub: "first-user" } }, error: null });
  })).mockResolvedValue({ data: { claims: { sub: "second-user" } }, error: null });
  const first = withWorkspaceRead(() => Promise.all([getAppSession(), getAppSession()]));
  const second = await withWorkspaceRead(() => Promise.all([getAppSession(), getAppSession()]));
  releaseFirst();
  const firstSessions = await first;
  expect(firstSessions.every(session => session.mode === "authenticated" && session.userId === "first-user")).toBe(true);
  expect(second.every(session => session.mode === "authenticated" && session.userId === "second-user")).toBe(true);
  expect(getClaims).toHaveBeenCalledTimes(2);
});
