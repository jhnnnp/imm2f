// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InviteManager } from "./InviteManager";
import { PartnerManage } from "./PartnerManage";

const mocks = vi.hoisted(() => ({ create: vi.fn(), leave: vi.fn(), copy: vi.fn(), share: vi.fn() }));
vi.mock("../session", () => ({ createCoupleInvite: mocks.create, leaveCouple: mocks.leave }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as string) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ token: "test-invitation", expiresAt: "2026-11-05T10:00:00.000Z" });
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
});
afterEach(cleanup);
async function ready() {
  render(createElement(InviteManager));
  fireEvent.click(screen.getByRole("button", { name: "초대 링크 만들기" }));
  await screen.findByRole("button", { name: "파트너에게 공유" });
}

it("prevents concurrent creation from replacing the invitation with a stale response", async () => {
  let resolve!: (result: { token: string; expiresAt: null }) => void;
  mocks.create.mockReturnValue(new Promise(done => { resolve = done; }));
  render(createElement(InviteManager));
  const create = screen.getByRole("button", { name: "초대 링크 만들기" });
  fireEvent.click(create); fireEvent.click(create);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  resolve({ token: "one-link", expiresAt: null });
  await screen.findByRole("button", { name: "파트너에게 공유" });
  expect((screen.getByRole("textbox", { name: "초대 링크" }) as HTMLInputElement).value).toContain("/invite/one-link");
});
it("copies the link when native sharing is unavailable and confirms that exact outcome", async () => {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "파트너에게 공유" }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining("/invite/test-invitation")));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", expect.stringContaining("링크를 복사했어요"));
});
it("does not silently copy a link after the user cancels the native share sheet", async () => {
  Object.defineProperty(navigator, "share", { configurable: true, value: mocks.share });
  mocks.share.mockRejectedValue(new DOMException("cancelled", "AbortError"));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "파트너에게 공유" }));
  await waitFor(() => expect(mocks.share).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((screen.getByRole("button", { name: "파트너에게 공유" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.copy).not.toHaveBeenCalled();
});
it("keeps the selected link available for manual copying after a clipboard failure", async () => {
  mocks.copy.mockRejectedValue(new Error("blocked"));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
  expect((await screen.findByRole("alert")).textContent).toContain("링크를 선택해서 복사");
  expect((screen.getByRole("textbox", { name: "초대 링크" }) as HTMLInputElement).value).toContain("test-invitation");
});
it("opens an explicit disconnect dialog with cancellation focused, without disconnecting", () => {
  render(createElement(PartnerManage, { youName: "나", partnerName: "파트너", connectedOn: null }));
  fireEvent.click(screen.getByRole("button", { name: "파트너 연결 해제" }));
  expect(screen.getByRole("dialog").textContent).toContain("빈 공간");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.leave).not.toHaveBeenCalled();
});
it("keeps failed disconnects in the dialog with a retryable error", async () => {
  mocks.leave.mockResolvedValue({ error: "연결 해제를 확인하지 못했어요" });
  render(createElement(PartnerManage, { youName: "나", partnerName: "파트너", connectedOn: null }));
  fireEvent.click(screen.getByRole("button", { name: "파트너 연결 해제" }));
  fireEvent.click(screen.getByRole("button", { name: "연결 해제하기" }));
  expect((await screen.findByRole("alert")).textContent).toContain("확인하지 못했어요");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
