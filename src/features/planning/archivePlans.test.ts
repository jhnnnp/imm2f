import { beforeEach, expect, it, vi } from "vitest";
import type { PlanItem } from "./types/plan";

const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn(), activity: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity, queuePartnerEmail: vi.fn() }));

import { archiveDatePlan, archiveTripPlan, listArchivedTripPlans } from "./actions";

function query(data: unknown) {
  const result = { data, error: null };
  const methods = ["insert", "select", "eq", "in", "order", "single"];
  const chain: Record<string, unknown> & PromiseLike<typeof result> = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of methods) chain[method] = vi.fn(() => chain);
  return chain;
}

const item: PlanItem = { id: "one", placeId: "place", placeName: "우리 카페", category: "카페", startTime: "12:00", durationMinutes: 60, expectedCost: 10000, order: 0, dayIndex: 0, memo: "", coordinates: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", coupleId: "ours", userId: "me" });
  mocks.activity.mockResolvedValue({ ok: true });
});

it("preserves the travel notes in both the memory and the archived itinerary", async () => {
  const memory = query({ id: "memory" });
  const db = { from: vi.fn(() => memory) };
  mocks.client.mockResolvedValue(db);
  const notes = "체크인 16시\n비 오면 미술관";
  expect(await archiveTripPlan({ title: "우리 여행", startDate: "2026-10-11", dayCount: 1, notes, items: [item] })).toEqual({ ok: true, id: "memory" });
  expect(memory.insert).toHaveBeenCalledWith(expect.objectContaining({ couple_id: "ours", description: notes }));
  expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ coupleId: "ours", afterValue: expect.objectContaining({ notes, items: [item] }) }));

  db.from.mockReturnValueOnce(query([{ id: "memory", title: "우리 여행", happened_on: "2026-10-11", description: notes }]))
    .mockReturnValueOnce(query([{ entity_id: "memory", after_value: { notes, items: [item], dayCount: 1 } }]));
  expect(await listArchivedTripPlans()).toEqual([expect.objectContaining({ id: "memory", notes, items: [item] })]);
});

it("keeps older archives readable and retains their canonical stored metadata", async () => {
  const from = vi.fn().mockReturnValueOnce(query([{ id: "old", title: "지난 여행", happened_on: "2026-10-01", description: "1일 · 1곳" }]))
    .mockReturnValueOnce(query([{ entity_id: "old", after_value: { items: [item], dayCount: 1 } }]));
  mocks.client.mockResolvedValue({ from });
  expect(await listArchivedTripPlans()).toEqual([expect.objectContaining({ id: "old", notes: "1일 · 1곳", items: [item] })]);
});

it("reads edited title and notes from the memory while preserving the original undated itinerary", async () => {
  const from = vi.fn().mockReturnValueOnce(query([{ id: "edited", title: "수정한 여행", happened_on: "2026-10-11", description: "수정한 메모" }]))
    .mockReturnValueOnce(query([{ entity_id: "edited", after_value: { startDate: "", notes: "옛 메모", items: [item], dayCount: 3 } }]));
  mocks.client.mockResolvedValue({ from });
  expect(await listArchivedTripPlans()).toEqual([expect.objectContaining({ id: "edited", title: "수정한 여행",
    notes: "수정한 메모", startDate: "", dayCount: 3, items: [item] })]);
});

it("rejects invalid archive dates and day counts without a database write", async () => {
  const db = { from: vi.fn() };
  mocks.client.mockResolvedValue(db);
  expect(await archiveDatePlan({ title: "데이트", date: "2026-02-30", notes: "", items: [item] })).toHaveProperty("error");
  expect(await archiveTripPlan({ title: "여행", startDate: "2026-10-11", dayCount: NaN, items: [item] })).toHaveProperty("error");
  expect(db.from).not.toHaveBeenCalled();
});
