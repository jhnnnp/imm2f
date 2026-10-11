import { inviteAcceptPath, isInviteToken } from "./invitePath";

/** Never derive email redirects from an untrusted Host or submitted form value. */
export function signupEmailRedirect(inviteToken?: string) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return undefined;
  try {
    const site = new URL(configured);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
    if (site.username || site.password || (site.protocol !== "https:" && !(site.protocol === "http:" && local && process.env.NODE_ENV !== "production"))) return undefined;
    const callback = new URL("/auth/callback", site.origin);
    if (inviteToken && isInviteToken(inviteToken)) callback.searchParams.set("next", inviteAcceptPath(inviteToken));
    return callback.href;
  } catch { return undefined; }
}
