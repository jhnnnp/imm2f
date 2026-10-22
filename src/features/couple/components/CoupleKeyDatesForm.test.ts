// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoupleKeyDatesSnapshot } from "../keyDates";
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), refresh: vi.fn(), emit: vi.fn(), session: { mode: "authenticated", userId: "user-a", coupleId: "couple-a", displayName: "나", partner: { userId: "user-b", displayName: "파트너" } as { userId: string; displayName: string } | null } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/auth/components/SessionProvider", () => ({ useAppSession: () => mocks.session }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => vi.fn() }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: mocks.emit }));
vi.mock("../keyDateActions", () => ({ readCoupleKeyDates: mocks.read, saveCoupleKeyDates: mocks.save }));
import { CoupleKeyDatesForm } from "./CoupleKeyDatesForm";
const empty: CoupleKeyDatesSnapshot = { dates: { relationshipStartedOn: null, birthdays: [] }, revision: 0, onboardingCompleted: false, persist: true, scope: { userId: "user-a", coupleId: "couple-a" } };
beforeEach(() => { vi.clearAllMocks(); mocks.session.partner = { userId: "user-b", displayName: "파트너" }; mocks.save.mockResolvedValue({ ok: true, snapshot: { ...empty, revision: 1, onboardingCompleted: true } }); });
afterEach(cleanup);
it("offers optional onboarding and skips with no invented personal dates", async () => {
  render(createElement(CoupleKeyDatesForm, { initial: empty, onboarding: true }));
  expect(screen.getByText(/양력 생일 기준/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "나중에 할게요" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ dates: empty.dates, expectedRevision: 0 })));
  expect(mocks.emit).toHaveBeenCalledWith(empty.scope);
});
it("prefills current names only for an empty draft and keeps new birthday identity across a lost-response retry", async () => {
  mocks.save.mockRejectedValueOnce(new Error("response lost"));
  render(createElement(CoupleKeyDatesForm, { initial: empty }));
  expect((screen.getByLabelText("생일 1 이름") as HTMLInputElement).value).toBe("나");
  expect((screen.getByLabelText("생일 2 이름") as HTMLInputElement).value).toBe("파트너");
  fireEvent.change(screen.getByLabelText("생일 1 날짜"), { target: { value: "2000-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "둘의 날짜 저장" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "둘의 날짜 저장" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[0][0]).toEqual(mocks.save.mock.calls[1][0]);
  expect(mocks.save.mock.calls[0][0].dates.birthdays[0].id).toMatch(/^[0-9a-f-]{36}$/);
});
it("keeps solo first-time users focused on connecting rather than collecting dates", () => {
  mocks.session.partner = null;
  render(createElement(CoupleKeyDatesForm, { initial: empty }));
  expect(screen.getByText(/파트너가 연결되면/)).toBeTruthy();
  expect(screen.queryByLabelText("사귀기 시작한 날")).toBeNull();
});
it("lets a remaining solo user edit already saved dates with the same identities", async () => {
  mocks.session.partner = null;
  const birthday = { id: "d9e5de9c-55b8-48bb-8d91-aa948c35b3d0", name: "명시한 이름", date: "2000-02-29" };
  render(createElement(CoupleKeyDatesForm, { initial: { ...empty, revision: 2, dates: { relationshipStartedOn: null, birthdays: [birthday] } } }));
  fireEvent.click(screen.getByRole("button", { name: "둘의 날짜 저장" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ dates: { relationshipStartedOn: null, birthdays: [birthday] } })));
});
it("preserves typed fields on a conflict and requires an explicit latest-value reload", async () => {
  mocks.save.mockResolvedValue({ error: "파트너가 먼저 수정했어요", conflict: true });
  render(createElement(CoupleKeyDatesForm, { initial: empty }));
  fireEvent.change(screen.getByLabelText("생일 1 이름"), { target: { value: "내 입력" } });
  fireEvent.change(screen.getByLabelText("생일 1 날짜"), { target: { value: "2000-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "둘의 날짜 저장" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("생일 1 이름") as HTMLInputElement).value).toBe("내 입력");
  expect((screen.getByRole("button", { name: "둘의 날짜 저장" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "입력 대신 최신 값 불러오기" })).toBeTruthy();
});
