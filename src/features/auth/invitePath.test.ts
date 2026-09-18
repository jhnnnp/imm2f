import { describe, expect, it } from "vitest";
import {
  inviteAcceptPath,
  inviteTokenFromPath,
  loginHrefForInvite,
  signupHrefForInvite,
  signedInAuthRedirect,
} from "./invitePath";

const token = "c9575c37973d4185973301a9e78ed0f16a9aa004b6974dcfa17b6e2a19af060e";

describe("invite path helpers", () => {
  it("reads an invite token from the accept path", () => {
    expect(inviteTokenFromPath(`/invite/${token}`)).toBe(token);
    expect(inviteTokenFromPath(`/invite/${token}?utm=share`)).toBe(token);
    expect(inviteTokenFromPath("/invite")).toBeNull();
    expect(inviteTokenFromPath("/invite/../login")).toBeNull();
    expect(inviteTokenFromPath("//evil.example")).toBeNull();
  });

  it("keeps the invite on login and signup links", () => {
    expect(loginHrefForInvite(token)).toBe(`/login?next=/invite/${token}`);
    expect(signupHrefForInvite(token)).toBe(`/signup?invite=${token}`);
    expect(loginHrefForInvite("")).toBe("/login");
    expect(signupHrefForInvite("../login")).toBe("/signup");
  });

  it("sends a signed-in user back to the invite instead of home", () => {
    expect(signedInAuthRedirect("/signup", new URLSearchParams(`invite=${token}`))).toBe(inviteAcceptPath(token));
    expect(signedInAuthRedirect("/login", new URLSearchParams(`next=/invite/${token}`))).toBe(inviteAcceptPath(token));
    expect(signedInAuthRedirect("/login", new URLSearchParams("next=/"))).toBe("/");
    expect(signedInAuthRedirect("/signup", new URLSearchParams())).toBe("/");
  });
});
