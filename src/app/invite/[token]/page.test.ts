import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import InviteTokenPage from "./page";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), session: vi.fn(), ownInvite: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ getInvitePreview: mocks.preview, getAppSession: mocks.session, isOwnCoupleInvite: mocks.ownInvite, acceptCoupleInvite: vi.fn() }));
const token = "c9575c37973d4185973301a9e78ed0f16";
beforeEach(() => {
  mocks.preview.mockReset().mockResolvedValue({ valid: true, inviterName: "상대", expiresAt: null });
  mocks.session.mockReset().mockResolvedValue({ mode: "guest" });
  mocks.ownInvite.mockReset().mockResolvedValue(false);
});

it("lets a verified account accept an invitation even while its solo space setup needs retry", async () => {
  mocks.session.mockResolvedValue({ mode: "setup_error", userId: "user-1", displayName: "나" });
  const html = renderToStaticMarkup(await InviteTokenPage({ params: Promise.resolve({ token }) }));
  expect(html).toContain("초대 수락하기");
  expect(html).toContain("기존 기록을 안전하게 보존");
  expect(html).not.toContain("가입하고 연결하기");
});

it("keeps signup and login options for a signed-out invitation recipient", async () => {
  const html = renderToStaticMarkup(await InviteTokenPage({ params: Promise.resolve({ token }) }));
  expect(html).toContain("가입하고 연결하기");
  expect(html).toContain(`/signup?invite=${token}`);
  expect(html).not.toContain("초대 수락하기");
});
