// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "@/features/planning/types/plan";

vi.mock("@/components/layout/AppLink", () => ({
  AppLink: (props: ComponentProps<"a">) => createElement("a", props),
}));
vi.mock("@/features/auth/components/SessionProvider", () => ({
  useAppSession: () => ({ mode: "authenticated", partner: { displayName: "현정" } }),
}));
import { HomeDashboard } from "./HomeDashboard";

const stop = (dayIndex: number, placeName: string): PlanItem => ({
  id: `stop-${dayIndex}`, placeId: `place-${dayIndex}`, placeName, dayIndex,
  category: "관광지", startTime: "", durationMinutes: 0, expectedCost: 0, order: dayIndex, memo: "",
});
const defaults: ComponentProps<typeof HomeDashboard> = {
  places: [], tripItems: [stop(0, "부산역"), stop(1, "광안리"), stop(2, "송도")],
  tripTitle: "부산 여행", tripStartDate: "2026-10-13", tripDayCount: 3,
  dateItems: [], dateTitle: "", dateStartDate: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T03:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("gives past travel a clear full date range and accessible trip link instead of an ambiguous D+ count", () => {
  render(createElement(HomeDashboard, defaults));
  const cover = screen.getByRole("link", { name: "지난 여행, 부산 여행" });
  expect(cover.getAttribute("href")).toBe("/trip");
  expect(within(cover).getByRole("heading", { name: "부산 여행" })).toBeTruthy();
  expect(within(cover).getByText("함께 다녀온 날")).toBeTruthy();
  expect(within(cover).getByText("2026년 10월 13일 — 10월 15일")).toBeTruthy();
  expect(within(cover).getByText(/여행 기록 열기/)).toBeTruthy();
  expect(within(cover).queryByText("D+9")).toBeNull();
});

it.each([
  { tripStartDate: null, tripItems: defaults.tripItems },
  { tripStartDate: "2026-10-13", tripItems: [] },
])("does not invent a departure mark for undated or empty travel: %j", overrides => {
  const { container } = render(createElement(HomeDashboard, { ...defaults, ...overrides }));
  const calendar = container.querySelector(".home-mini-cal");
  expect(calendar).toBeTruthy();
  expect(calendar?.querySelector(".is-start")).toBeNull();
  expect(calendar?.querySelector(".is-trip")).toBeNull();
  expect(calendar?.querySelector(".is-today")?.textContent).toBe("22");
});

it("keeps selected next-month dates in the sixth row of the rendered cover calendar", () => {
  const { container } = render(createElement(HomeDashboard, { ...defaults, tripStartDate: "2026-10-31", tripDayCount: 4 }));
  const cells = container.querySelectorAll(".home-mini-cal-days > span");
  expect(cells).toHaveLength(42);
  expect(cells[34].classList.contains("is-start")).toBe(true);
  expect(Array.from(cells).slice(35, 38).map(cell => cell.textContent)).toEqual(["1", "2", "3"]);
  Array.from(cells).slice(35, 38).forEach(cell => {
    expect(cell.classList.contains("is-trip")).toBe(true);
    expect(cell.classList.contains("is-out")).toBe(true);
  });
  expect(screen.getByRole("link", { name: "다가오는 여행, 부산 여행" }).textContent)
    .toContain("2026년 10월 31일 — 11월 3일");
});

it("keeps itinerary day navigation working while the cover retains its past-travel context", () => {
  render(createElement(HomeDashboard, defaults));
  expect(screen.getByText("1일차")).toBeTruthy();
  expect((screen.getByRole("button", { name: "이전 날짜" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "다음 날짜" }));
  act(() => { vi.advanceTimersByTime(420); });
  expect(screen.getByText("2일차")).toBeTruthy();
  expect(screen.getByText("광안리")).toBeTruthy();
  expect(screen.queryByText("부산역")).toBeNull();
  expect((screen.getByRole("button", { name: "이전 날짜" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("link", { name: "지난 여행, 부산 여행" })).toBeTruthy();
});
