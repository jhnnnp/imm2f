// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
const mocks = vi.hoisted(() => ({ propose: vi.fn(), save: vi.fn(), openPanel: vi.fn() }));
vi.mock("@/features/ai/actions", () => ({ proposePlanEdits: mocks.propose, recommendDatePlanWithSession: vi.fn() }));
vi.mock("@/features/ai/candidateExplorationActions", () => ({ prepareCandidateExploration: vi.fn(),
  exploreCandidateGroups: vi.fn(), replaceRejectedCandidateFromSession: vi.fn(), updateCandidateExplorationChoices: vi.fn() }));
vi.mock("@/features/planning/actions", () => ({ saveCouplePlan: mocks.save, archiveTripPlan: vi.fn(),
  listArchivedTripPlans: vi.fn(), loadCouplePlan: vi.fn() }));
vi.mock("@/features/collaboration/workspaceReads", () => ({ readTripWorkspace: vi.fn() }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => vi.fn() }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: vi.fn() }));
vi.mock("@/features/planning/useHydratePlanCoordinates", () => ({ useHydratePlanCoordinates: vi.fn() }));
vi.mock("@/features/planning/components/PlanTimeline", () => ({ PlanTimeline: () => null }));
vi.mock("@/components/layout/ContextPanelDrawer", () => ({ openContextPanel: mocks.openPanel }));
vi.mock("@/components/layout/ContextPanel", async () => {
  const React = await import("react");
  return { ContextPanel: ({ children }: { children: ReactNode }) => React.createElement("div", null, children) };
});
vi.mock("@/components/shared/DatePickerButton", () => ({ DatePickerButton: () => null }));
vi.mock("@/features/places/components/PlaceLocationMap", () => ({ PlaceLocationMap: () => null }));
vi.mock("@/features/trip/components/PlanMap", () => ({ PlanMap: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/dynamic", async () => {
  const { AIPlanEditor } = await import("@/features/ai/components/AIPlanEditor");
  return { default: (loader: () => Promise<unknown>) => loader.toString().includes("AIPlanEditor") ? AIPlanEditor : () => null };
});
import { TripPlanner } from "./TripPlanner";

const item: PlanItem = { id: "real-other-day", placeId: "kakao:1", placeName: "첫날에만 있는 카페", category: "카페",
  startTime: "14:00", durationMinutes: 60, expectedCost: 10000, order: 0, memo: "", dayIndex: 0 };
const plan: CouplePlan = { persist: true, revision: 2, items: [item], title: "우리 여행", notes: "",
  startDate: "2026-10-11", dayCount: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.propose.mockResolvedValue({ changes: [], summary: "현재 일정에는 바꿀 항목이 없어요." });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it("does not send another trip day's places for AI edits when the selected day is empty", async () => {
  render(createElement(TripPlanner, { initialPlan: plan, initialArchives: [], initialDay: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "AI로 다듬기" }));
  fireEvent.click(screen.getByRole("tab", { name: "일정 수정" }));
  fireEvent.click(screen.getByRole("button", { name: "변경안 만들기" }));
  expect(screen.getByRole("alert").textContent).toContain("수정할 일정이 없어요");
  expect(mocks.propose).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("sends only the selected nonempty day's places to the edit action", async () => {
  const nextPlan = { ...plan, items: [item, { ...item, id: "second-day", placeName: "둘째날 장소", dayIndex: 1 }] };
  render(createElement(TripPlanner, { initialPlan: nextPlan, initialArchives: [], initialDay: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "AI로 다듬기" }));
  fireEvent.click(screen.getByRole("button", { name: "변경안 만들기" }));
  await waitFor(() => expect(mocks.propose).toHaveBeenCalledTimes(1));
  expect(mocks.propose.mock.calls[0][0].items.map((row: PlanItem) => row.id)).toEqual(["second-day"]);
  expect(mocks.save).not.toHaveBeenCalled();
});
