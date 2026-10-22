import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/memories/actions", () => ({ updateMemory: mocks.update, deleteMemory: mocks.remove }));
import { deleteArchivedTripPlan, updateArchivedTripPlan } from "./archiveActions";

const id = "33333333-3333-4333-8333-333333333333";
const memory = { id, title: "부산 여행", description: "바다 산책", happened_on: "2026-10-13",
  location_label: "해운대 · 카페", memory_type: "trip", lng: 129.1, lat: 35.1 };
const input = { id, title: "우리의 부산", notes: "남긴 이야기", expected: { title: memory.title, notes: memory.description } };
let chain: ReturnType<typeof query>;
function query(data: unknown, error: unknown = null) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  return chain;
}
beforeEach(() => {
  vi.clearAllMocks();
  chain = query(memory);
  mocks.session.mockResolvedValue({ mode: "authenticated", coupleId: "ours", userId: "me" });
  mocks.client.mockResolvedValue({ from: vi.fn(() => chain) });
  mocks.update.mockResolvedValue({ memory: { title: input.title, description: input.notes } });
  mocks.remove.mockResolvedValue({ ok: true });
});

it("scopes the record to the authenticated couple and reuses an atomic metadata edit without changing dates, photos or itinerary", async () => {
  expect(await updateArchivedTripPlan(input)).toEqual({ ok: true, title: input.title, notes: input.notes });
  expect(chain.eq).toHaveBeenCalledWith("id", id);
  expect(chain.eq).toHaveBeenCalledWith("couple_id", "ours");
  expect(chain.eq).toHaveBeenCalledWith("memory_type", "trip");
  expect(mocks.update).toHaveBeenCalledWith({ id, title: input.title, description: input.notes,
    attemptId: expect.any(String), expectedSnapshot: JSON.stringify([memory.title, memory.happened_on,
      memory.description, memory.location_label, memory.memory_type, [memory.lng, memory.lat]]),
    happenedOn: memory.happened_on, locationLabel: memory.location_label, memoryType: "trip", lng: memory.lng, lat: memory.lat });
});

it("does not overwrite a partner edit made before the dialog was saved", async () => {
  chain.maybeSingle.mockResolvedValue({ data: { ...memory, description: "파트너가 바꾼 메모" }, error: null });
  expect(await updateArchivedTripPlan(input)).toMatchObject({ conflict: true });
  expect(mocks.update).not.toHaveBeenCalled();
});

it("returns the existing atomic RPC conflict if another edit races the scoped read", async () => {
  mocks.update.mockResolvedValue({ error: "파트너가 이 추억을 수정했어요.", conflict: true });
  expect(await updateArchivedTripPlan(input)).toMatchObject({ conflict: true });
});

it("acknowledges a retry whose earlier ambiguous edit already committed", async () => {
  chain.maybeSingle.mockResolvedValue({ data: { ...memory, title: input.title, description: input.notes }, error: null });
  expect(await updateArchivedTripPlan(input)).toEqual({ ok: true, title: input.title, notes: input.notes });
  expect(mocks.update).not.toHaveBeenCalled();
});

it("rejects absent or other-couple records without calling either write API", async () => {
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await updateArchivedTripPlan(input)).toMatchObject({ conflict: true });
  expect(await deleteArchivedTripPlan(id)).toEqual({ ok: true });
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});

it("checks authentication before accessing records", async () => {
  mocks.session.mockResolvedValue({ mode: "demo" });
  expect(await updateArchivedTripPlan(input)).toHaveProperty("error");
  expect(await deleteArchivedTripPlan(id)).toHaveProperty("error");
  expect(mocks.client).not.toHaveBeenCalled();
});

it.each(["", "other", "123"])("rejects an invalid archive ID %s without accessing records", async invalid => {
  expect(await updateArchivedTripPlan({ ...input, id: invalid })).toHaveProperty("error");
  expect(await deleteArchivedTripPlan(invalid)).toHaveProperty("error");
  expect(mocks.client).not.toHaveBeenCalled();
});

it("uses the existing deletion flow only after confirming a couple-owned trip", async () => {
  expect(await deleteArchivedTripPlan(id)).toEqual({ ok: true });
  expect(chain.eq).toHaveBeenCalledWith("couple_id", "ours");
  expect(chain.eq).toHaveBeenCalledWith("memory_type", "trip");
  expect(mocks.remove).toHaveBeenCalledWith(id);
});

it("returns a deletion failure without claiming the record was removed", async () => {
  mocks.remove.mockResolvedValue({ error: "삭제하지 못했어요." });
  expect(await deleteArchivedTripPlan(id)).toHaveProperty("error", "삭제하지 못했어요.");
});
