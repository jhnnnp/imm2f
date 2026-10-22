// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ArchivedTripPlan } from "@/features/planning/actions";

const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn() }));
vi.mock("../archiveActions", () => ({ updateArchivedTripPlan: mocks.update, deleteArchivedTripPlan: mocks.remove }));
import { TripArchivePanel } from "./TripArchivePanel";

const journey: ArchivedTripPlan = { id: "33333333-3333-4333-8333-333333333333", title: "부산 바다 여행",
  startDate: "2026-10-13", dayCount: 3, notes: "둘이 걷던 해변", status: "completed",
  items: [{ id: "one", placeId: "cafe", placeName: "해운대 카페", category: "카페", startTime: "13:00",
    durationMinutes: 60, expectedCost: 10000, dayIndex: 0, order: 0, memo: "" }] };
function props(overrides: Partial<Parameters<typeof TripArchivePanel>[0]> = {}) {
  return { journeys: [journey], notice: "", onOpen: vi.fn(), onUpdated: vi.fn(), onDeleted: vi.fn(),
    onReload: vi.fn().mockResolvedValue(undefined), ...overrides };
}
function openEditor() { fireEvent.click(screen.getByRole("button", { name: `${journey.title} 수정` })); }
function openDelete() { fireEvent.click(screen.getByRole("button", { name: `${journey.title} 삭제` })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ ok: true, title: "수정한 여행", notes: "새 메모" });
  mocks.remove.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

it("shows the record identity and separate open, map and management actions", () => {
  const input = props(); render(createElement(TripArchivePanel, input));
  expect(screen.getByRole("heading", { name: journey.title })).toBeTruthy();
  expect(screen.getByText("2026-10-13 ~ 2026-10-15")).toBeTruthy();
  expect(screen.getByText("장소 1곳")).toBeTruthy(); expect(screen.getByText("해운대 카페")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `${journey.title} 여행기록 열기` }));
  expect(input.onOpen).toHaveBeenCalledWith(journey);
  expect(screen.getByRole("link", { name: /기억 지도/ }).getAttribute("href")).toBe("/our-map");
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});

it("edits only title and notes with the exact original metadata for conflict checking", async () => {
  const input = props(); render(createElement(TripArchivePanel, input)); openEditor();
  const dialog = screen.getByRole("dialog", { name: "여행기록 수정" });
  expect(within(dialog).getByLabelText("여행 제목")).toHaveProperty("value", journey.title);
  expect(dialog.querySelector('input[type="date"]')).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("여행 제목"), { target: { value: "수정한 여행" } });
  fireEvent.change(within(dialog).getByLabelText(/여행 메모/), { target: { value: "새 메모" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "변경 사항 저장" }));
  await waitFor(() => expect(input.onUpdated).toHaveBeenCalledWith(journey.id, expect.objectContaining({ title: "수정한 여행", notes: "새 메모" })));
  expect(mocks.update).toHaveBeenCalledWith({ id: journey.id, title: "수정한 여행", notes: "새 메모",
    expected: { title: journey.title, notes: journey.notes } });
  expect(screen.queryByRole("dialog")).toBeNull(); expect(input.onDeleted).not.toHaveBeenCalled();
});

it("retains the draft and existing record after an update fails", async () => {
  mocks.update.mockResolvedValue({ error: "저장하지 못했어요." });
  const input = props(); render(createElement(TripArchivePanel, input)); openEditor();
  fireEvent.change(screen.getByLabelText(/여행 메모/), { target: { value: "아직 저장 안 된 이야기" } });
  fireEvent.click(screen.getByRole("button", { name: "변경 사항 저장" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText(/여행 메모/)).toHaveProperty("value", "아직 저장 안 된 이야기");
  expect(input.onUpdated).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: journey.title })).toBeTruthy();
});

it("offers a reload after a partner conflict and never overwrites that record", async () => {
  mocks.update.mockResolvedValue({ error: "파트너가 수정했어요.", conflict: true });
  const input = props(); render(createElement(TripArchivePanel, input)); openEditor();
  fireEvent.click(screen.getByRole("button", { name: "변경 사항 저장" }));
  fireEvent.click(await screen.findByRole("button", { name: "최신 기록 불러오기" }));
  await waitFor(() => expect(input.onReload).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(input.onUpdated).not.toHaveBeenCalled();
});

it("requires explicit deletion confirmation and focuses cancellation first", () => {
  const input = props(); render(createElement(TripArchivePanel, input)); openDelete();
  const dialog = screen.getByRole("dialog", { name: "여행기록을 삭제할까요?" });
  expect(within(dialog).getByText(/기록과 연결된 사진/)).toBeTruthy();
  const cancel = within(dialog).getByRole("button", { name: "취소" });
  expect(document.activeElement).toBe(cancel);
  expect(mocks.remove).not.toHaveBeenCalled(); fireEvent.click(cancel);
  expect(screen.queryByRole("dialog")).toBeNull(); expect(input.onDeleted).not.toHaveBeenCalled();
});

it("submits one delete across rapid clicks and removes the card only after success", async () => {
  const result = deferred<{ ok: true }>(); mocks.remove.mockReturnValueOnce(result.promise);
  const input = props(); render(createElement(TripArchivePanel, input)); openDelete();
  const confirm = screen.getByRole("button", { name: "여행기록 삭제" });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(mocks.remove).toHaveBeenCalledTimes(1); expect(input.onDeleted).not.toHaveBeenCalled();
  await act(async () => result.resolve({ ok: true }));
  expect(input.onDeleted).toHaveBeenCalledWith(journey.id); expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the record after deletion fails and allows retry", async () => {
  mocks.remove.mockResolvedValue({ error: "삭제하지 못했어요." });
  const input = props(); render(createElement(TripArchivePanel, input)); openDelete();
  fireEvent.click(screen.getByRole("button", { name: "여행기록 삭제" })); await screen.findByRole("alert");
  expect(input.onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "여행기록 삭제" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("heading", { name: journey.title })).toBeTruthy();
});

it("closes with Escape without submitting a mutation", () => {
  render(createElement(TripArchivePanel, props())); openEditor(); fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull(); expect(mocks.update).not.toHaveBeenCalled();
});

it("supports an empty record list and undated records without fabricated places", () => {
  const view = render(createElement(TripArchivePanel, props({ journeys: [] })));
  expect(screen.getByText("함께 남길 여행이 기다리고 있어요")).toBeTruthy();
  view.rerender(createElement(TripArchivePanel, props({ journeys: [{ ...journey, startDate: "", items: [], notes: "" }] })));
  expect(screen.getByText("날짜 미정")).toBeTruthy(); expect(screen.getByText("장소 0곳")).toBeTruthy();
  expect(screen.queryByText("해운대 카페")).toBeNull();
});
