import { expect, it } from "vitest";
import { appSessionIdentity, type AppSession } from "./types";

const account: AppSession = { mode: "authenticated", userId: "user-a", coupleId: "couple-a", displayName: "나", partner: null };

it("refreshes the workspace when setup recovers under the same account", () => {
  expect(appSessionIdentity(account)).not.toBe(appSessionIdentity({ mode: "setup_error", userId: "user-a", displayName: "나" }));
});

it("distinguishes account, couple and sign-out transitions", () => {
  expect(appSessionIdentity(account)).not.toBe(appSessionIdentity({ ...account, coupleId: "couple-b" }));
  expect(appSessionIdentity(account)).not.toBe(appSessionIdentity({ ...account, userId: "user-b" }));
  expect(appSessionIdentity(account)).not.toBe(appSessionIdentity({ mode: "guest" }));
});

it("retains current local edits when a partner name or profile changes", () => {
  expect(appSessionIdentity(account)).toBe(appSessionIdentity({ ...account, displayName: "새 이름", partner: { userId: "partner", displayName: "상대" } }));
});
