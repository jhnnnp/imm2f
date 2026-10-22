import { beforeEach, expect, it, vi } from "vitest";
import { getWorkspaceReadContext } from "@/lib/supabase/readContext";
import { readCalendarWorkspace, readDateWorkspace, readMapWorkspace, readPlacesWorkspace, readTripWorkspace } from "./workspaceReads";

const reads = vi.hoisted(() => ({ plan: vi.fn(), drafts: vi.fn(), dates: vi.fn(), trips: vi.fn(), tripDrafts: vi.fn(), tripDate: vi.fn(), places: vi.fn(), memories: vi.fn(), marks: vi.fn(), project: vi.fn(), keyDates: vi.fn() }));
vi.mock("@/features/planning/actions", () => ({ loadCouplePlan: reads.plan, listDateDrafts: reads.drafts, listArchivedDatePlans: reads.dates, listArchivedTripPlans: reads.trips, listTripDrafts: reads.tripDrafts, readTripDate: reads.tripDate }));
vi.mock("@/features/places/actions", () => ({ listPlaces: reads.places }));
vi.mock("@/features/memories/actions", () => ({ listMemories: reads.memories, listMemoryCalendarMarks: reads.marks }));
vi.mock("@/features/date/tripDayPlans", () => ({ projectTripDayPlans: reads.project }));
vi.mock("@/features/couple/keyDateActions", () => ({ readCoupleKeyDates: reads.keyDates }));
const contexts: unknown[] = [];
beforeEach(() => {
  contexts.length = 0;
  for (const mock of Object.values(reads)) mock.mockReset();
  const result = <T>(value: T) => { contexts.push(getWorkspaceReadContext()); return Promise.resolve(value); };
  reads.plan.mockImplementation((kind: string) => result({ kind, revision: "new" }));
  reads.drafts.mockImplementation(() => result([{ date: "2026-10-15" }]));
  reads.dates.mockImplementation(() => result({ persist: true, dates: [{ id: "date-archive" }] }));
  reads.trips.mockImplementation(() => result([{ id: "trip-archive" }]));
  reads.tripDrafts.mockImplementation(() => result([{ startDate: "2026-11-01" }]));
  reads.tripDate.mockImplementation((startDate?: string | null) => result({ plan: startDate === undefined ? { kind: "trip", revision: "new" } : { startDate, revision: "active" }, drafts: [{ startDate: "2026-11-01" }] }));
  reads.places.mockImplementation(() => result({ persist: true, places: [{ id: "place" }] }));
  reads.memories.mockImplementation(() => result({ persist: true, memories: [{ id: "memory" }] }));
  reads.keyDates.mockImplementation(() => result({ dates: { relationshipStartedOn: null, birthdays: [] } }));
  reads.project.mockReturnValue([{ id: "shared-trip-day" }]);
  reads.marks.mockImplementation(() => result([{ id: "mark" }]));
});

it("refreshes date archives alongside the active plan and saved dates in one read scope", async () => {
  const result = await readDateWorkspace();
  expect(result).toEqual({ plan: { kind: "date", revision: "new" }, drafts: [{ date: "2026-10-15" }], archives: [{ id: "date-archive" }], tripDays: [{ id: "shared-trip-day" }], tripSyncError: "" });
  expect(reads.project).toHaveBeenCalledWith({ kind: "trip", revision: "new" }, [{ startDate: "2026-11-01" }], [{ id: "trip-archive" }]);
  expect(contexts).toHaveLength(5);
  expect(contexts[0]).toBeDefined();
  expect(contexts.every(context => context === contexts[0])).toBe(true);
});

it("refreshes every map source so partner memories and archived trips become visible", async () => {
  expect(await readMapWorkspace()).toEqual({ places: [{ id: "place" }], trip: { kind: "trip", revision: "new" }, archives: [{ id: "trip-archive" }], memories: [{ id: "memory" }] });
  expect(reads.memories).toHaveBeenCalledWith({ photos: "cover" });
  expect(contexts).toHaveLength(4);
  expect(contexts.every(context => context === contexts[0])).toBe(true);
});

it("refreshes archived trips and place trip metadata while preserving persistence state", async () => {
  expect(await readTripWorkspace()).toEqual({ plan: { kind: "trip", revision: "new" }, drafts: [{ startDate: "2026-11-01" }], archives: [{ id: "trip-archive" }] });
  expect(contexts).toHaveLength(2);
  const firstScope = contexts[0];
  contexts.length = 0;
  expect(await readPlacesWorkspace()).toEqual({ places: { persist: true, places: [{ id: "place" }] }, trip: { kind: "trip", revision: "new" }, archives: [{ id: "trip-archive" }] });
  expect(contexts.every(context => context === contexts[0])).toBe(true);
  expect(contexts[0]).not.toBe(firstScope);
});

it("refreshes calendar inputs together without replacing a failed snapshot with empty data", async () => {
  expect(await readCalendarWorkspace()).toMatchObject({ trip: { kind: "trip" }, date: { kind: "date" }, memories: [{ id: "mark" }] });
  reads.marks.mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(readCalendarWorkspace()).rejects.toThrow("provider unavailable");
});

it.each(["2026-11-01", ""])("refreshes Places trip context for the explicit viewed start date %j", async tripDate => {
  expect(await readPlacesWorkspace(tripDate)).toEqual({
    places: { persist: true, places: [{ id: "place" }] }, trip: { startDate: tripDate, revision: "active" }, archives: [{ id: "trip-archive" }],
  });
  expect(reads.tripDate).toHaveBeenCalledWith(tripDate);
  expect(reads.plan).not.toHaveBeenCalled();
  expect(contexts).toHaveLength(3);
  expect(contexts.every(context => context === contexts[0])).toBe(true);
});

 it("reads the requested trip date or undated draft without activating or writing it", async () => {
  expect(await readTripWorkspace("2026-11-01")).toEqual({ plan: { startDate: "2026-11-01", revision: "active" }, drafts: [{ startDate: "2026-11-01" }], archives: [{ id: "trip-archive" }] });
  expect(reads.tripDate).toHaveBeenLastCalledWith("2026-11-01");
  expect(contexts).toHaveLength(2);
  expect(contexts.every(context => context === contexts[0])).toBe(true);
  await readTripWorkspace(null);
  expect(reads.tripDate).toHaveBeenLastCalledWith(null);
  expect(reads.plan).not.toHaveBeenCalled();
});

it("keeps the date plan available and reports a retryable trip sync failure", async () => {
  reads.tripDate.mockRejectedValueOnce(new Error("temporarily unavailable"));
  expect(await readDateWorkspace()).toMatchObject({ plan: { kind: "date" }, archives: [{ id: "date-archive" }], tripDays: null, tripSyncError: expect.stringContaining("다시 조회") });
  expect(reads.project).not.toHaveBeenCalled();
});
