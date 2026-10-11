import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirectPath";
import { signedInAuthRedirect } from "./invitePath";

describe("authentication redirect destinations", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\tevil.example", "javascript:alert(1)", "", null])("rejects external or ambiguous destinations: %s", value => {
    expect(safeNextPath(value)).toBe("/");
  });
  it("keeps an internal page, its filters and fragment", () => {
    expect(safeNextPath("/places?view=map#saved")).toBe("/places?view=map#saved");
    expect(signedInAuthRedirect("/login", new URLSearchParams({ next: "/places?view=map" }))).toBe("/places?view=map");
  });
  it("avoids redirect loops back into authentication pages", () => {
    for (const next of ["/login", "/signup?invite=x", "/auth/callback?code=old"]) {
      expect(signedInAuthRedirect("/login", new URLSearchParams({ next }))).toBe("/");
    }
  });
});
