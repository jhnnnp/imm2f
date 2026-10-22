// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarBoard } from "./CalendarBoard";
import type { CouplePlan } from "@/features/planning/types/plan";
import { formatKoDate } from "@/lib/dates";

vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => vi.fn() }));
vi.mock("@/features/collaboration/workspaceReads", () => ({ readCalendarWorkspace: vi.fn() }));
vi.mock("@/lib/dates", async () => ({ ...await vi.importActual("@/lib/dates"), seoulTodayIso: () => "2026-10-22" }));
vi.mock("../usePublicHolidays", () => ({ usePublicHolidays: () => ({ holidays: [{ date: "2026-10-09", name: "한글날" }], source: "https://astro.kasi.re.kr/life/post/calendarData", loading: false, error: "", message: "한국천문연구원 자료 기준", retry: vi.fn() }) }));
const empty: CouplePlan = { persist: true, revision: 1, startDate: null, title: "", notes: "", dayCount: 1, items: [] };
afterEach(cleanup);

it("places official holidays on the correct date and shows their full name in the day dialog", () => {
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [], drafts: [] }));
  const holiday = screen.getByRole("button", { name: `${formatKoDate("2026-10-09")} · 한글날` });
  expect(holiday.className).toContain("is-holiday");
  fireEvent.click(holiday);
  expect(within(screen.getByRole("dialog")).getByText("한글날")).toBeTruthy();
  expect(within(screen.getByRole("dialog")).queryByText("아직 일정이 없는 날이에요.")).toBeNull();
  expect(screen.queryByRole("link", { name: /공휴일 출처/ })).toBeNull();
});
it("automatically displays both saved birthdays and recurring relationship anniversaries", () => {
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [], drafts: [], keyDates: {
    relationshipStartedOn: "2024-10-22", birthdays: [{ id: "you", name: "진한", date: "1998-10-05" }, { id: "partner", name: "현정", date: "1999-10-09" }],
  } }));
  expect(screen.getByRole("button", { name: `${formatKoDate("2026-10-05")} · 진한의 생일` })).toBeTruthy();
  const together = screen.getByRole("button", { name: `${formatKoDate("2026-10-09")} · 한글날, 현정의 생일` });
  fireEvent.click(together);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("현정의 생일")).toBeTruthy();
  expect(within(dialog).getByText("한글날")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
  fireEvent.click(screen.getByRole("button", { name: `${formatKoDate("2026-10-22")} · 우리의 2주년` }));
  expect(within(screen.getByRole("dialog")).getByText("우리의 2주년")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /우리의 날짜 수정|생일·기념일 입력/ })).toBeNull();
});
it("uses the familiar Sunday-first calendar while keeping month navigation and today working", () => {
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [], drafts: [] }));
  const weekdays = [...document.querySelectorAll(".week.labels span")].map(span => span.textContent);
  expect(weekdays).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
  fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
  expect(screen.getByText("2026년 11월")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "오늘" }));
  expect(screen.getByText("2026년 10월")).toBeTruthy();
});

it("keeps all six weeks in a long month without a registration banner", () => {
  render(createElement(CalendarBoard, { trip: empty, date: empty, memories: [], drafts: [] }));
  fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
  fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
  expect(screen.getByText("2026년 8월")).toBeTruthy();
  expect(document.querySelectorAll(".calendar-dates > button")).toHaveLength(42);
  expect((document.querySelector(".calendar-grid") as HTMLElement).style.getPropertyValue("--calendar-weeks")).toBe("6");
  expect(screen.queryByRole("region", { name: "우리의 중요한 날짜" })).toBeNull();
  expect(screen.queryByText("둘의 날짜를 오래 기억해요")).toBeNull();
});
