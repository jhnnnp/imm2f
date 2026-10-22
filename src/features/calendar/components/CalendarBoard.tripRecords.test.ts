// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import type { ArchivedTripPlan } from "@/features/planning/actions";
vi.mock("../usePublicHolidays", () => ({ usePublicHolidays: () => ({ holidays: [], source: "", loading: false, error: "", message: "", retry: vi.fn() }) }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => vi.fn() }));
vi.mock("@/features/collaboration/workspaceReads", () => ({ readCalendarWorkspace: vi.fn() }));
vi.mock("@/lib/dates", async () => ({ ...await vi.importActual("@/lib/dates"), seoulTodayIso: () => "2026-10-11" }));
import { CalendarBoard } from "./CalendarBoard";
import { formatKoDate } from "@/lib/dates";
const item: PlanItem = { id: "cafe", placeId: "cafe", placeName: "부산 카페", category: "카페", memo: "", dayIndex: 0, order: 0, startTime: "13:00", durationMinutes: 60, expectedCost: 0 };
const empty: CouplePlan = { persist: true, revision: 4, startDate: null, title: "우리가 고른 여행", notes: "", dayCount: 1, items: [] };
const archive: ArchivedTripPlan = { id: "record", title: "부산 2박 3일", startDate: "2026-10-11", dayCount: 3, notes: "", status: "completed", items: [item, { ...item, id: "second", placeName: "둘째날 바다", dayIndex: 1 }] };
afterEach(cleanup);
it("keeps a completed trip on all its calendar days with the correct history link and daily places", () => {
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [{ id: archive.id, title: archive.title, happenedOn: archive.startDate }], drafts: [], archives: [archive] }));
  fireEvent.click(screen.getByRole("button", { name: `${formatKoDate("2026-10-12")} · 여행` }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("link", { name: /부산 2박 3일/ }).getAttribute("href")).toBe("/trip?archive=record&day=1");
  expect(within(dialog).getByText("2026-10-11 ~ 2026-10-13 · DAY 2 · 1곳")).toBeTruthy();
  expect(within(dialog).getByText("둘째날 바다")).toBeTruthy(); expect(within(dialog).queryByText(item.placeName)).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
  fireEvent.click(screen.getByRole("button", { name: `${formatKoDate("2026-10-11")} · 여행, 추억` }));
  expect(within(screen.getByRole("dialog")).getAllByRole("link", { name: /부산 2박 3일/ })).toHaveLength(1);
});
it("traps keyboard focus and restores the selected date button when the modal closes", () => {
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [], drafts: [], archives: [archive] }));
  const dateButton = screen.getByRole("button", { name: `${formatKoDate("2026-10-12")} · 여행` }); dateButton.focus(); fireEvent.click(dateButton);
  const dialog = screen.getByRole("dialog"); const close = within(dialog).getByRole("button", { name: "닫기" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(within(dialog).getByRole("link", { name: "이날의 데이트 계획하기" }));
  fireEvent.keyDown(document, { key: "Tab" }); expect(document.activeElement).toBe(close);
  fireEvent.keyDown(document, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(dateButton);
});
it("renders more than one saved travel on the same date without merging its daily places", () => {
  const another = { ...archive, id: "another", title: "다른 여행", items: [{ ...item, id: "other", placeName: "다른 여행의 장소" }] };
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [], drafts: [], archives: [archive, another] }));
  fireEvent.click(screen.getByRole("button", { name: `${formatKoDate("2026-10-11")} · 여행` }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("link", { name: /부산 2박 3일/ }).getAttribute("href")).toBe("/trip?archive=record&day=0");
  expect(within(dialog).getByRole("link", { name: /다른 여행/ }).getAttribute("href")).toBe("/trip?archive=another&day=0");
  expect(within(dialog).getByText("다른 여행의 장소")).toBeTruthy(); expect(within(dialog).getByText(item.placeName)).toBeTruthy();
});
