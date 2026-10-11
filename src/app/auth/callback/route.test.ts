import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const { exchange, rpc } = vi.hoisted(() => ({ exchange: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: exchange }, rpc }) }));

beforeEach(() => {
  exchange.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ error: null });
});

it("keeps OAuth callbacks on this origin even for a protocol-relative next URL", async () => {
  const response = await GET(new Request("https://only-us.example/auth/callback?code=ok&next=%2F%2Fevil.example"));
  expect(response.headers.get("location")).toBe("https://only-us.example/");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("does not initialize a space after a failed or missing authorization code", async () => {
  exchange.mockResolvedValue({ error: { message: "Expired code" } });
  const response = await GET(new Request("https://only-us.example/auth/callback?code=expired"));
  expect(response.headers.get("location")).toBe("https://only-us.example/login?error=auth_callback");
  expect(rpc).not.toHaveBeenCalled();
  exchange.mockClear();
  await GET(new Request("https://only-us.example/auth/callback"));
  expect(exchange).not.toHaveBeenCalled();
});

it("recovers from authorization transport rejection without creating a workspace", async () => {
  exchange.mockRejectedValue(new TypeError("fetch failed"));
  const response = await GET(new Request("https://only-us.example/auth/callback?code=ok"));
  expect(response.headers.get("location")).toBe("https://only-us.example/login?error=auth_callback");
  expect(rpc).not.toHaveBeenCalled();
});

it("preserves the authenticated session and opens setup recovery after an RPC rejection", async () => {
  rpc.mockRejectedValue(new TypeError("fetch failed"));
  const response = await GET(new Request("https://only-us.example/auth/callback?code=ok"));
  expect(response.headers.get("location")).toBe("https://only-us.example/?error=space_setup");
  expect(exchange).toHaveBeenCalledTimes(1);
});
