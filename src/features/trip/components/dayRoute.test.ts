import { expect, it } from "vitest";
import type { PlanItem } from "@/features/planning/types/plan";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dayRoutes } from "./dayRoute";
import { PlanMap } from "./PlanMap";

const item = (dayIndex: number, order: number): PlanItem => ({ id: `${dayIndex}-${order}`,
  placeId: `venue-${dayIndex}-${order}`, placeName: `장소 ${dayIndex}-${order}`, category: "카페",
  startTime: "12:00", durationMinutes: 60, expectedCost: 0, order, memo: "", dayIndex,
  coordinates: [129 + order / 100, 35 + dayIndex / 100] });

it("derives independent day routes, with marker numbers restarting at one", () => {
  const routes = dayRoutes([item(0, 2), item(1, 2), item(2, 3), item(0, 1),
    item(2, 1), item(1, 1), item(2, 2)]);
  expect(routes.map(route => route.dayIndex)).toEqual([0, 1, 2]);
  expect(routes.map(route => route.stops.map(stop => stop.order))).toEqual([[1, 2], [1, 2], [1, 2, 3]]);
  expect(routes[1].stops.map(stop => stop.candidateId)).toEqual(["venue-1-1", "venue-1-2"]);
  expect(routes[1].stops.some(stop => stop.candidateId.startsWith("venue-0"))).toBe(false);
});

it("renders one tab per itinerary day and selects the first day initially", () => {
  const html = renderToStaticMarkup(createElement(PlanMap,
    { items: [item(0, 1), item(1, 1), item(2, 1)] }));
  expect(html).toContain('aria-label="지도 날짜 선택"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain("1일차");
  expect(html).toContain("2일차");
  expect(html).toContain("3일차");
  expect(html).not.toContain(">전체</button>");
});
