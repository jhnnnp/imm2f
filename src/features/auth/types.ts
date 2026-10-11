export type AppSession =
  | { mode: "guest" }
  | {
      mode: "setup_error";
      userId: string;
      displayName: string;
    }
  | {
      mode: "authenticated";
      userId: string;
      displayName: string;
      coupleId: string;
      partner: { userId: string; displayName: string } | null;
    };

/** Includes setup state so recovering account setup also rebuilds RSC data. */
export function appSessionIdentity(session: AppSession) {
  return session.mode === "authenticated"
    ? `authenticated:${session.userId}:${session.coupleId}`
    : session.mode === "setup_error" ? `setup_error:${session.userId}` : "guest";
}

export function initialFromName(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "나";
}
