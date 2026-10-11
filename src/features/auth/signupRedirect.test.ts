import { afterEach, expect, it, vi } from "vitest";
import { signupEmailRedirect } from "./signupRedirect";

const token = "c9575c37973d4185973301a9e78ed0f16";
afterEach(() => vi.unstubAllEnvs());

it("uses the configured site origin and retains the invitation in a PKCE callback", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://only-us.example/unneeded/path");
  const callback = new URL(signupEmailRedirect(token)!);
  expect(callback.origin).toBe("https://only-us.example");
  expect(callback.pathname).toBe("/auth/callback");
  expect(callback.searchParams.get("next")).toBe(`/invite/${token}`);
});

it.each(["javascript:alert(1)", "https://user:password@example.com", "http://outside.example", "not-a-url", ""]) ("rejects an unsafe configured redirect: %s", site => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  expect(signupEmailRedirect(token)).toBeUndefined();
});

it("only permits a loopback HTTP origin during development", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
  vi.stubEnv("NODE_ENV", "development");
  expect(signupEmailRedirect()).toBe("http://127.0.0.1:3000/auth/callback");
  vi.stubEnv("NODE_ENV", "production");
  expect(signupEmailRedirect()).toBeUndefined();
});
