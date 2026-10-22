// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanItem } from "../types/plan";
import { PlanItemCard } from "./PlanItemCard";

afterEach(cleanup);
const item: PlanItem = { id: "one", placeId: "place-one", placeName: "우리 카페", category: "카페",
  startTime: "14:30", durationMinutes: 90, expectedCost: 20000, order: 0, dayIndex: 0, memo: "통창 좌석" };
const props = () => ({ item, index: 1, onDragStart: vi.fn(), onDrop: vi.fn(), onEdit: vi.fn(),
  onUpdate: vi.fn(), onDragEnter: vi.fn(), onDragEnd: vi.fn(), editing: true, dragging: false, dropTarget: false });

it("shows the place order while hiding schedule details and editing controls when time is disabled", () => {
  const callbacks = props();
  const view = render(createElement(PlanItemCard, { ...callbacks, showTime: false }));
  expect(screen.getByText("02")).toBeTruthy();
  expect(screen.getByRole("heading", { name: item.placeName })).toBeTruthy();
  expect(screen.getByText(item.memo, { selector: "p:not([aria-hidden])" })).toBeTruthy();
  expect(view.container.querySelector("article")?.draggable).toBe(true);
  expect(view.container.querySelector("time")).toBeNull();
  expect(screen.queryByText("90분")).toBeNull();
  expect(screen.queryByLabelText("일정 시간")).toBeNull();
  expect(screen.queryByLabelText("소요 시간")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `${item.placeName} 일정 메뉴` }));
  expect(screen.queryByRole("menuitem", { name: /시간/ })).toBeNull();
  expect(callbacks.onUpdate).not.toHaveBeenCalled();
});

it("keeps existing schedule editing available when time is enabled", () => {
  render(createElement(PlanItemCard, props()));
  expect(screen.getByText("14:30").tagName).toBe("TIME");
  expect(screen.getByText("90분")).toBeTruthy();
  expect(screen.getByLabelText("일정 시간")).toBeTruthy();
  expect(screen.getByLabelText("소요 시간")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `${item.placeName} 일정 메뉴` }));
  expect(screen.getByRole("menuitem", { name: "시간 변경 취소" })).toBeTruthy();
});

it("keeps the letter card's numbered stamp", () => {
  const view = render(createElement(PlanItemCard, { ...props(), variant: "letter", showTime: false }));
  expect(screen.getByText("02").className).toBe("letter-stamp");
  expect(view.container.querySelector("time")).toBeNull();
});
