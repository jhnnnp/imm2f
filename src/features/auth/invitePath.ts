const INVITE_TOKEN = /^[0-9a-f]{32,128}$/i;
const INVITE_PATH = /^\/invite\/([0-9a-f]{32,128})$/i;

export function inviteTokenFromPath(path: string | null | undefined) {
  const value = String(path ?? "").trim().split("?")[0];
  const match = value.match(INVITE_PATH);
  return match?.[1] ?? null;
}

export function isInviteToken(value: string | null | undefined) {
  return INVITE_TOKEN.test(String(value ?? "").trim());
}

export function inviteAcceptPath(token: string) {
  return `/invite/${token}`;
}

export function loginHrefForInvite(inviteToken?: string | null) {
  if (!inviteToken || !isInviteToken(inviteToken)) return "/login";
  return `/login?next=${inviteAcceptPath(inviteToken)}`;
}

export function signupHrefForInvite(inviteToken?: string | null) {
  if (!inviteToken || !isInviteToken(inviteToken)) return "/signup";
  return `/signup?invite=${inviteToken}`;
}

export function signedInAuthRedirect(pathname: string, searchParams: { get(name: string): string | null }) {
  if (pathname === "/signup") {
    const invite = searchParams.get("invite")?.trim() ?? "";
    if (isInviteToken(invite)) return inviteAcceptPath(invite);
  }
  if (pathname === "/login") {
    const token = inviteTokenFromPath(searchParams.get("next"));
    if (token) return inviteAcceptPath(token);
  }
  return "/";
}
