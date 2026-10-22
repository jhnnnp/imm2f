// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UpcomingKeyDate } from "../homeMoments";
import type { CoupleNote } from "@/features/lists/types";

vi.mock("@/components/layout/AppLink", () => ({
  AppLink: (props: ComponentProps<"a">) => createElement("a", props),
}));
import { BucketWishCard, MomentLoading, MomentUnavailable, UpcomingDaysCard } from "./HomeMoments";

afterEach(cleanup);
const birthday: UpcomingKeyDate = {
  id: "birthday:partner:2026", date: "2026-10-22", title: "현정의 생일", kind: "birthday",
  detail: "매년 함께 챙기는 생일", daysUntil: 0,
};
const wish: CoupleNote = {
  id: "bucket /뮤지컬", kind: "bucket", title: "뮤지컬 같이 보기", detail: "연극 다음은 뮤지컬이다!",
  status: "planning", extra: "올해 안에", createdAt: "2026-10-22T00:00:00Z",
};

it("shows today's birthday with its actual date and a date-specific planning link", () => {
  render(createElement(UpcomingDaysCard, { events: [birthday] }));
  const region = screen.getByRole("region", { name: "다가오는 기념일" });
  expect(within(region).getByText("오늘이에요")).toBeTruthy();
  expect(within(region).getByRole("heading", { name: "현정의 생일" })).toBeTruthy();
  expect(region.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-22");
  expect(within(region).getByRole("link", { name: /이날의 데이트 준비/ }).getAttribute("href")).toBe("/date?day=2026-10-22");
  expect(within(region).getByRole("link", { name: /선물 아이디어/ }).getAttribute("href")).toBe("/gifts");
});

it("keeps following milestones separate and displays their own dates and countdowns", () => {
  const next: UpcomingKeyDate = { ...birthday, id: "anniversary:2027", kind: "anniversary", title: "우리의 3주년", date: "2027-01-01", daysUntil: 71 };
  render(createElement(UpcomingDaysCard, { events: [birthday, next] }));
  const following = screen.getByRole("list", { name: "그다음 기념일" });
  expect(within(following).getByText("우리의 3주년")).toBeTruthy();
  expect(within(following).getByText("D−71")).toBeTruthy();
  expect(following.querySelector("time")?.getAttribute("datetime")).toBe("2027-01-01");
});

it("leaves no empty calendar card or registration prompt when there are no dates", () => {
  const { container } = render(createElement(UpcomingDaysCard, { events: [] }));
  expect(container.childElementCount).toBe(0);
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps the original wish, memo and target timeframe with an exact encoded list anchor", () => {
  render(createElement(BucketWishCard, { wish }));
  expect(screen.getByRole("heading", { name: wish.title })).toBeTruthy();
  expect(screen.getByText(wish.detail)).toBeTruthy();
  expect(screen.getByText(wish.extra)).toBeTruthy();
  expect(screen.getByText("함께 계획 중")).toBeTruthy();
  expect(screen.getByRole("link", { name: /이 바람 이어가기/ }).getAttribute("href"))
    .toBe(`/bucket#bucket-note-${encodeURIComponent(wish.id)}`);
  expect(screen.getByRole("link", { name: /모든 바람 보기/ }).getAttribute("href")).toBe("/bucket");
});

it("celebrates completed wishes while providing a path to add the next wish", () => {
  render(createElement(BucketWishCard, { wish: null, completed: 4 }));
  expect(screen.getByText("함께 이룬 바람 4개")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "다음엔, 무엇을 함께할까요?" })).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/bucket");
  expect(screen.queryByText("함께 계획 중")).toBeNull();
});

it("offers an honest first-wish state when no bucket has been saved", () => {
  render(createElement(BucketWishCard, { wish: null }));
  expect(screen.getByText("우리의 첫 번째 바람")).toBeTruthy();
  expect(screen.getByRole("link", { name: /첫 바람 남기기/ }).getAttribute("href")).toBe("/bucket");
  expect(screen.queryByText(/함께 이룬 바람/)).toBeNull();
});

it("distinguishes loading from an unavailable source and offers recovery destinations", () => {
  const { rerender, container } = render(createElement(MomentLoading, { kind: "dates" }));
  expect(screen.getByRole("region", { name: "기념일 불러오는 중" }).getAttribute("aria-busy")).toBe("true");
  rerender(createElement(MomentUnavailable, { kind: "dates" }));
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(screen.getByRole("link", { name: /우리의 날짜 확인/ }).getAttribute("href")).toBe("/insights#our-dates");
  rerender(createElement(MomentUnavailable, { kind: "wish" }));
  expect(screen.getByRole("link", { name: /버킷리스트 열기/ }).getAttribute("href")).toBe("/bucket");
});
