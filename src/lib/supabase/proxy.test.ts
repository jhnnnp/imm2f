import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "./proxy";

const { getClaims, clientFactory } = vi.hoisted(() => ({ getClaims: vi.fn(), clientFactory: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: clientFactory }));
vi.mock("./env", () => ({ getSupabaseUrl: () => "https://example.supabase.co", getSupabaseKey: () => "public", isSupabaseConfigured: () => true }));

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: null } });
  clientFactory.mockReset().mockReturnValue({ auth: { getClaims } });
});

it.each(["/api/map-tiles/9/427/195", "/api/kakao-map-key", "/api/map-route"]) ("does not validate auth for public map resources: %s", async pathname => {
  const response = await updateSession(new NextRequest(`https://only-us.example${pathname}`));
  expect(response.status).toBe(200);
  expect(clientFactory).not.toHaveBeenCalled();
});

it("forwards rotated cookies and nonce to rendering and keeps cookies on redirects", async () => {
  getClaims.mockImplementation(async () => {
    const options = clientFactory.mock.lastCall![2];
    options.cookies.setAll([{ name: "sb-auth-token", value: "new", options: { httpOnly: true } }], { "cache-control": "private, no-store", pragma: "no-cache" });
    return { data: { claims: { sub: "user" } } };
  });
  const request = new NextRequest("https://only-us.example/login?next=%2Fplaces%3Fview%3Dmap", { headers: { cookie: "sb-auth-token=old" } });
  const response = await updateSession(request, new Headers({ cookie: "sb-auth-token=old", "x-nonce": "csp-nonce" }));
  expect(response.headers.get("location")).toBe("https://only-us.example/places?view=map");
  expect(response.cookies.get("sb-auth-token")?.value).toBe("new");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");

  const pageResponse = await updateSession(new NextRequest("https://only-us.example/places", { headers: { cookie: "sb-auth-token=old" } }), new Headers({ "x-nonce": "csp-nonce" }));
  expect(pageResponse.headers.get("x-middleware-request-cookie")).toContain("sb-auth-token=new");
  expect(pageResponse.headers.get("x-middleware-request-x-nonce")).toBe("csp-nonce");
});

it("returns an API authentication error and preserves a browser destination", async () => {
  const api = await updateSession(new NextRequest("https://only-us.example/api/private"));
  expect(api.status).toBe(401);
  expect(api.headers.get("content-type")).toContain("application/json");
  const page = await updateSession(new NextRequest("https://only-us.example/places?view=map"));
  expect(new URL(page.headers.get("location")!).searchParams.get("next")).toBe("/places?view=map");
});

it("does not falsely sign a user out during a transient auth provider outage", async () => {
  getClaims.mockResolvedValue({ data: null, error: { name: "AuthRetryableFetchError", status: 503 } });
  const response = await updateSession(new NextRequest("https://only-us.example/places"));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
});
