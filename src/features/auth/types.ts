export type AppSession =
  | { mode: "prototype" }
  | { mode: "demo" }
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

export function initialFromName(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "나";
}
