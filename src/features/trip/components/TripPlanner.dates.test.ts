// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CouplePlan, PlanItem } from "@/features/planning/types/plan";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { TripDateSnapshot } from "../tripDates";
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), move: vi.fn(), archive: vi.fn(), archives: vi.fn(), active: vi.fn(), updateRecord: vi.fn(), deleteRecord: vi.fn() }));
vi.mock("@/features/planning/actions", () => ({ saveCouplePlan: mocks.save, rescheduleTripPlan: mocks.move, archiveTripPlan: mocks.archive, listArchivedTripPlans: mocks.archives, loadCouplePlan: mocks.active }));
vi.mock("../archiveActions", () => ({ updateArchivedTripPlan: mocks.updateRecord, deleteArchivedTripPlan: mocks.deleteRecord }));
vi.mock("@/features/collaboration/workspaceReads", () => ({ readTripWorkspace: mocks.read }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => vi.fn() }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: vi.fn() }));
vi.mock("@/features/planning/useHydratePlanCoordinates", () => ({ useHydratePlanCoordinates: vi.fn() }));
vi.mock("@/features/planning/components/PlanTimeline", () => ({ PlanTimeline: ({ items, onRemove }: { items: PlanItem[]; onRemove: (id: string) => void }) => createElement("div", null, items.map(item => createElement("div", { key: item.id }, item.placeName, createElement("button", { onClick: () => onRemove(item.id) }, "장소 제거")))) }));
vi.mock("@/components/layout/ContextPanelDrawer", () => ({ openContextPanel: vi.fn() }));
vi.mock("@/components/layout/ContextPanel", () => ({ ContextPanel: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("@/components/shared/DatePickerButton", () => ({ DatePickerButton: ({ value, ariaLabel, disabled, onChange }: { value: string; ariaLabel: string; disabled: boolean; onChange: (value: string) => void }) => createElement("input", { value, "aria-label": ariaLabel, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { TripPlanner } from "./TripPlanner";
const item: PlanItem = { id: "cafe", placeId: "cafe", placeName: "부산 카페", category: "카페", memo: "둘이 앉을 자리", dayIndex: 0, order: 0, startTime: "13:00", durationMinutes: 60, expectedCost: 0 };
const plan: CouplePlan = { persist: true, revision: 2, startDate: "2026-10-11", title: "부산 여행", notes: "체크인 16시", dayCount: 3, items: [item] };
const target: TripDateSnapshot = { startDate: "2026-11-01", title: "제주 여행", notes: "바다", dayCount: 2, items: [{ ...item, id: "sea", placeName: "제주 바다" }], updatedAt: "2026-10-11T01:00:00Z" };
const archived: ArchivedTripPlan = { ...target, id: "record", status: "completed" };
function workspace(next: CouplePlan) { return { plan: next, drafts: [target], archives: [archived] }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function view(props: Partial<Parameters<typeof TripPlanner>[0]> = {}) { return render(createElement(TripPlanner, { initialPlan: plan, initialArchives: [archived], initialDrafts: [target], ...props })); }
function choose(date: string) { fireEvent.change(screen.getByLabelText("여행 날짜 조회"), { target: { value: date } }); }
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/trip");
  mocks.save.mockResolvedValue({ ok: true, revision: 3, version: 3 });
  mocks.read.mockResolvedValue(workspace({ ...plan, ...target, revision: 4 }));
  mocks.move.mockResolvedValue({ ok: true, revision: 4 });
  mocks.active.mockResolvedValue(plan);
  mocks.archive.mockResolvedValue({ ok: true, id: "new-record" });
  mocks.archives.mockResolvedValue([archived]);
  mocks.updateRecord.mockResolvedValue({ ok: true, title: "수정한 제주 여행", notes: "새 여행 메모" });
  mocks.deleteRecord.mockResolvedValue({ ok: true });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
it("queries another date without saving or copying the current itinerary", async () => {
  view(); choose(target.startDate);
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", target.title));
  expect(mocks.read).toHaveBeenCalledWith(target.startDate);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.move).not.toHaveBeenCalled();
  expect(screen.queryByText(item.placeName)).toBeNull();
  expect(screen.getByText(target.items[0].placeName)).toBeTruthy();
  expect(window.location.search).toBe("?date=2026-11-01");
  expect(screen.getByRole("link", { name: "＋ 이 날에 장소 추가" }).getAttribute("href")).toBe("/places?from=trip&day=0&tripDate=2026-11-01");
});
it("opens an unused date as an empty trip and leaves the saved current trip untouched", async () => {
  mocks.read.mockResolvedValue(workspace({ ...plan, startDate: "2026-12-01", title: "우리가 고른 여행", notes: "", items: [], dayCount: 1 }));
  view(); choose("2026-12-01");
  await waitFor(() => expect(screen.getByText("여행 초안이 비어 있어요")).toBeTruthy());
  expect(screen.queryByText(item.placeName)).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("조회 완료 · 일정 없음");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "이 날의 장소 찾기" }).getAttribute("href")).toContain("tripDate=2026-12-01");
});
it("can return to the undated saved trip without assigning current places", async () => {
  mocks.read.mockResolvedValue(workspace({ ...plan, ...target, startDate: null }));
  view(); choose("");
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(null));
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", target.title));
  expect(window.location.search).toBe("?date="); expect(mocks.save).not.toHaveBeenCalled();
});
it("does not write on an unchanged title or note blur", () => {
  view(); fireEvent.blur(screen.getByLabelText("여행 제목"));
  fireEvent.click(screen.getByRole("button", { name: "여행 노트" }));
  fireEvent.blur(screen.getByLabelText("여행 노트"));
  expect(mocks.save).not.toHaveBeenCalled();
});
it("flushes an edited old title before reading the selected date", async () => {
  const save = deferred<{ ok: true; revision: number; version: number }>(); mocks.save.mockReturnValueOnce(save.promise);
  view(); fireEvent.change(screen.getByLabelText("여행 제목"), { target: { value: "수정한 부산 여행" } }); choose(target.startDate);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith("trip", [item], expect.objectContaining({ title: "수정한 부산 여행", startDate: plan.startDate, expectedRevision: 2 }));
  await act(async () => { save.resolve({ ok: true, revision: 3, version: 3 }); });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith(target.startDate));
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it("waits for an already queued save and prevents stale old-input saves during the read", async () => {
  const save = deferred<{ ok: true; revision: number; version: number }>(); const read = deferred<ReturnType<typeof workspace>>();
  mocks.save.mockReturnValueOnce(save.promise); mocks.read.mockReturnValueOnce(read.promise);
  view(); fireEvent.click(screen.getByRole("button", { name: "여행 노트" }));
  const note = screen.getByLabelText("여행 노트"); fireEvent.change(note, { target: { value: "수정된 체크인" } }); fireEvent.blur(note); choose(target.startDate);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1)); expect(mocks.read).not.toHaveBeenCalled();
  await act(async () => { save.resolve({ ok: true, revision: 3, version: 3 }); });
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1)); fireEvent.blur(note);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => { read.resolve(workspace({ ...plan, ...target, revision: 3 })); });
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", target.title));
});
it("keeps current edits visible and does not query the next date after a failed flush", async () => {
  mocks.save.mockResolvedValue({ error: "저장 실패" }); view();
  fireEvent.change(screen.getByLabelText("여행 제목"), { target: { value: "아직 미저장" } }); choose(target.startDate);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("저장 실패"));
  expect(mocks.read).not.toHaveBeenCalled(); expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", "아직 미저장");
});
it("retains the old visible trip if a date read fails and does not offer a wrong save retry", async () => {
  mocks.read.mockRejectedValue(new Error("private upstream detail")); view(); choose(target.startDate);
  await waitFor(() => expect(screen.getByText(/선택한 날짜의 여행을 불러오지 못했어요/)).toBeTruthy());
  expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", plan.title);
  expect(screen.queryByRole("button", { name: "다시 저장" })).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});
it("activates the viewed draft and waits for its new revision before explicitly moving it", async () => {
  view({ initialPlan: { ...plan, ...target }, initialDrafts: [] });
  fireEvent.click(screen.getByRole("button", { name: "여행 날짜 변경" }));
  fireEvent.change(screen.getByLabelText("새 여행 시작일"), { target: { value: "2026-12-01" } });
  mocks.read.mockResolvedValue(workspace({ ...plan, ...target, startDate: "2026-12-01", revision: 4 }));
  fireEvent.click(screen.getByRole("button", { name: "확인하고 날짜 변경" }));
  await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
  expect(mocks.save).toHaveBeenCalledWith("trip", target.items, expect.objectContaining({ title: target.title, startDate: target.startDate, expectedRevision: 2 }));
  expect(mocks.move).toHaveBeenCalledWith({ startDate: "2026-12-01", expectedRevision: 3, expectedTargetUpdatedAt: undefined });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("requires replacement approval and sends the confirmed target concurrency stamp", async () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "여행 날짜 변경" }));
  fireEvent.change(screen.getByLabelText("새 여행 시작일"), { target: { value: target.startDate } });
  const submit = screen.getByRole("button", { name: "확인하고 날짜 변경" }); expect(submit).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: "확인한 여행을 현재 코스로 교체할게요." })); fireEvent.click(submit);
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith({ startDate: target.startDate, expectedRevision: 3, expectedTargetUpdatedAt: target.updatedAt }));
});
it("keeps a committed move successful if its subsequent refresh fails", async () => {
  mocks.read.mockRejectedValue(new Error("read offline")); view(); fireEvent.click(screen.getByRole("button", { name: "여행 날짜 변경" }));
  fireEvent.change(screen.getByLabelText("새 여행 시작일"), { target: { value: "2026-12-01" } }); fireEvent.click(screen.getByRole("button", { name: "확인하고 날짜 변경" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("여행 날짜 조회")).toHaveProperty("value", "2026-12-01");
  expect(screen.getByText(/날짜는 변경됐지만/)).toBeTruthy(); expect(mocks.move).toHaveBeenCalledTimes(1);
});
it("reopens a saved trip read-only without replacing or saving the active trip", async () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "지난 여행" })); fireEvent.click(screen.getByRole("button", { name: `${archived.title} 여행기록 열기` }));
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("readOnly", true));
  expect(screen.getByRole("button", { name: "AI로 다듬기" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "여행 날짜 변경" })).toBeNull(); expect(screen.queryByRole("button", { name: "장소 제거" })).toBeNull();
  fireEvent.blur(screen.getByLabelText("여행 제목")); fireEvent.click(screen.getByRole("button", { name: "여행 노트" }));
  expect(screen.getByLabelText("여행 노트")).toHaveProperty("readOnly", true); fireEvent.blur(screen.getByLabelText("여행 노트"));
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.archive).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?archive=record&day=0");
  fireEvent.click(screen.getByRole("button", { name: "현재 여행으로 돌아가기" }));
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("readOnly", false));
  expect(mocks.save).not.toHaveBeenCalled(); expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", plan.title);
});
it("uses the requested archive day from the calendar and retains the historical place order", () => {
  const record = { ...archived, items: [item, { ...item, id: "day-2", placeName: "기록 둘째날 장소", dayIndex: 1 }] };
  view({ initialPlan: { ...plan, ...record, notes: "" }, initialArchives: [record], initialArchiveId: record.id, initialDay: 1 });
  expect(screen.getByText("기록 둘째날 장소")).toBeTruthy(); expect(screen.queryByText(item.placeName)).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});
it("shows archive viewing guidance without offering an unavailable date-change instruction", () => {
  view({ initialPlan: { ...plan, ...archived, notes: archived.notes ?? "" }, initialArchiveId: archived.id });
  expect(screen.getByText(/저장한 여행기록을 보고 있어요/)).toBeTruthy();
  expect(screen.queryByText(/현재 코스를 옮기려면/)).toBeNull();
  expect(screen.queryByRole("button", { name: "여행 날짜 변경" })).toBeNull();
});
it("saves a complete travel record with the renamed action", async () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "여행기록 저장" }));
  await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith({ title: plan.title, notes: plan.notes, startDate: plan.startDate, dayCount: 3, items: [item] }));
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(screen.queryByText("이 여행 기록하기")).toBeNull();
});

it("updates record metadata without saving or replacing the active travel draft", async () => {
  view(); fireEvent.click(screen.getByRole("button", { name: "지난 여행" }));
  fireEvent.click(screen.getByRole("button", { name: `${archived.title} 수정` }));
  fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox", { name: "여행 제목" }), { target: { value: "수정한 제주 여행" } });
  fireEvent.change(screen.getByRole("textbox", { name: /여행 메모/ }), { target: { value: "새 여행 메모" } });
  fireEvent.click(screen.getByRole("button", { name: "변경 사항 저장" }));
  await screen.findByRole("heading", { name: "수정한 제주 여행" });
  fireEvent.click(screen.getByRole("button", { name: "수정한 제주 여행 여행기록 열기" }));
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", "수정한 제주 여행"));
  expect(screen.getByLabelText("여행 날짜 조회")).toHaveProperty("value", archived.startDate);
  expect(screen.getByText(archived.items[0].placeName)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "여행 노트" }));
  expect(screen.getByLabelText("여행 노트")).toHaveProperty("value", "새 여행 메모");
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.archive).not.toHaveBeenCalled();
});

it("returns to the active draft when the viewed record is deleted and never deletes the draft", async () => {
  view({ initialPlan: { ...plan, ...archived, notes: archived.notes ?? "" }, initialArchiveId: archived.id });
  fireEvent.click(screen.getByRole("button", { name: "지난 여행" }));
  fireEvent.click(screen.getByRole("button", { name: `${archived.title} 삭제` }));
  expect(mocks.deleteRecord).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "여행기록 삭제" }));
  await waitFor(() => expect(screen.getByLabelText("여행 제목")).toHaveProperty("value", plan.title));
  expect(mocks.deleteRecord).toHaveBeenCalledWith(archived.id);
  expect(screen.getByLabelText("여행 제목")).toHaveProperty("readOnly", false);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.move).not.toHaveBeenCalled();
  expect(window.location.search).toBe("");
});
