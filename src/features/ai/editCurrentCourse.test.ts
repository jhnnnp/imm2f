import { expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { editCurrentCourse } from "./editCurrentCourse";
import type { AIPlannerReply } from "@/features/planning/types/plan";

const state = { ...emptyDateBrief(), startTime: "09:00", endTime: "17:00", nights: 2, stayKind: "overnight" as const };
const items = [0, 0, 1, 1, 2, 2].map((dayIndex, index) => ({ id: `i${index}`, placeId: `p${index}`, placeName: `장소${index}`,
  category: "카페", startTime: index % 2 ? "10:00" : "09:00", durationMinutes: 60, expectedCost: 0, order: index, memo: "", dayIndex }));
const plan: AIPlannerReply = { status: "plan", message: "코스", state, items,
  condition: { dateLabel: "", startTime: "09:00", endTime: "17:00", region: "", budget: null, timeSpecified: true },
  card: { headline: "", lines: [] }, candidateCount: items.length, source: "fallback",
  recommendations: items.map(item => ({ id: item.placeId, placeId: item.placeId, name: item.placeName, category: "카페", district: "", address: "", phone: "", mapUrl: "", coordinates: null,
    durationMinutes: 60, expectedCost: 0, reasons: [], isSaved: false, distanceFromPreviousMeters: null })) };

it("retimes the first stop of the second day without using the first day's final stop or shifting the third day", () => {
  const result = editCurrentCourse(plan, { kind: "retime", indices: [] }, state, { targetItemId: "i2", targetStartTime: "09:30", verifiedTravelMinutes: [0, 0, 120, 0, 0] });
  expect(result.status).toBe("plan");
  if (result.status === "plan") expect(result.items.map(item => item.startTime)).toEqual(["09:00", "10:00", "09:30", "12:30", "09:00", "10:00"]);
});

it.each([[2, 1], [1, 1, 3, 4, 5, 6], [1, 2, 3, 4, 5, 99]])("preserves the full course on malformed reorder %j", indices => {
  const result = editCurrentCourse(plan, { kind: "reorder", indices }, state);
  expect(result.status).toBe("chat");
  expect(result.message).toContain("기존 코스는 유지");
  expect(plan.items).toHaveLength(6);
});

it("keeps the original course when a targeted shift overflows the target day's window", () => {
  const result = editCurrentCourse(plan, { kind: "retime", indices: [] }, state, { targetItemId: "i2", targetStartTime: "16:00", verifiedTravelMinutes: [0, 0, 120, 0, 0] });
  expect(result.status).toBe("chat");
});

it("changes places and visit order without fitting legacy clocks in a route-only recommendation", () => {
  const routeState = { ...state, routeOnly: true, startTime: "23:58", endTime: "23:59" };
  const routePlan = { ...plan, state: routeState };
  const result = editCurrentCourse(routePlan, { kind: "remove", indices: [2] }, routeState);
  expect(result.status).toBe("plan");
  if (result.status !== "plan") return;
  expect(result.items.map(item => item.placeName)).toEqual(["장소0", "장소2", "장소3", "장소4", "장소5"]);
  expect(result.condition.timeSpecified).toBe(false);
  expect(result.card.stops?.every(stop => stop.startTime === undefined && stop.durationMinutes === undefined)).toBe(true);
  expect(result.message).not.toContain("시간");
  expect(result.state.routeOnly).toBe(true);
});

it("does not turn a route-only recommendation into a timed schedule during a follow-up", () => {
  const routePlan = { ...plan, state: { ...state, routeOnly: true } };
  const result = editCurrentCourse(routePlan, { kind: "retime", indices: [] }, routePlan.state);
  expect(result.status).toBe("chat");
  expect(result.message).toContain("장소와 방문 순서");
  expect(routePlan.items).toEqual(items);
});
