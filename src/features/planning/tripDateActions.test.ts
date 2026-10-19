import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanItem } from "./types/plan";
const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn(), activity: vi.fn(), email: vi.fn(), revalidate: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity, queuePartnerEmail: mocks.email }));
import { addItemToCouplePlan, archiveTripPlan, listArchivedTripPlans, listTripDrafts, readTripDate, rescheduleTripPlan, saveCouplePlan } from "./actions";
function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const chain: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result> = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) } as never;
  for (const method of ["select", "eq", "in", "order", "range", "limit", "maybeSingle", "single", "insert", "delete"]) chain[method] = vi.fn(() => chain);
  return chain;
}
const item: PlanItem = { id: "cafe", placeId: "cafe", placeName: "부산 카페", category: "카페", memo: "", dayIndex: 0, order: 0, startTime: "13:00", durationMinutes: 60, expectedCost: 0, coordinates: [129, 35] };
const active = { id: "active", kind: "trip", start_date: "2026-10-11", title: "부산 여행", subtitle: "체크인 16시", day_count: 3, revision_id: 8 };
const activeItem = { client_id: item.id, place_id: item.placeId, place_name: item.placeName, category: item.category, memo: item.memo, day_index: 0, sort_order: 0, start_time: item.startTime, duration_minutes: 60, expected_cost: 0, lng: 129, lat: 35 };
const draft = { scheduled_on: "2026-11-01", title: "제주 여행", notes: "바다", day_count: 2, items: [{ ...item, id: "sea", placeName: "제주 바다" }], updated_at: "2026-10-11T01:00:00Z" };
const legacySchema = { code: "PGRST200", message: "Relationship missing in schema cache" };
function clientFor(rows: unknown[] = [draft], plan: typeof active | null = active) {
  const queries: Array<{ table: string; query: ReturnType<typeof query> }> = [];
  const client = { from: vi.fn((table: string) => {
    if (table === "couples") return query(null, legacySchema);
    const next = query(table === "plans" ? plan : table === "plan_items" ? [activeItem] : table === "trip_drafts" ? rows : []);
    queries.push({ table, query: next }); return next;
  }), rpc: vi.fn().mockResolvedValue({ data: { plan_id: "active", version: 9, revision: 9 }, error: null }) };
  mocks.client.mockResolvedValue(client); return { client, queries };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue({ mode: "authenticated", coupleId: "ours", userId: "me", displayName: "나", partner: null });
  mocks.activity.mockResolvedValue({ ok: true }); mocks.email.mockResolvedValue(undefined);
});
describe("trip draft reads", () => {
  it("filters by the authenticated couple and preserves undated drafts and concurrency stamps", async () => {
    const { client, queries } = clientFor([draft, { ...draft, scheduled_on: null, title: "날짜 미정 여행" }, { ...draft, scheduled_on: "2026-02-30" }, { ...draft, title: "우리가 고른 여행", notes: "", items: [] }]);
    expect(await listTripDrafts()).toEqual([
      expect.objectContaining({ startDate: draft.scheduled_on, title: draft.title, dayCount: 2, updatedAt: draft.updated_at }),
      expect.objectContaining({ startDate: "", title: "날짜 미정 여행" }),
    ]);
    expect(queries[0].query.eq).toHaveBeenCalledWith("couple_id", "ours");
    expect(queries[0].query.range).toHaveBeenCalledWith(0, 999);
    expect(client.rpc).not.toHaveBeenCalled(); expect(queries[0].query.insert).not.toHaveBeenCalled();
  });
  it("paginates past the provider's default thousand-row response limit", async () => {
    const pages = [query(Array.from({ length: 1000 }, () => draft)), query([{ ...draft, scheduled_on: null }])];
    const from = vi.fn().mockReturnValueOnce(pages[0]).mockReturnValueOnce(pages[1]); mocks.client.mockResolvedValue({ from });
    expect(await listTripDrafts()).toHaveLength(1001);
    expect(pages[0].range).toHaveBeenCalledWith(0, 999); expect(pages[1].range).toHaveBeenCalledWith(1000, 1999);
    expect(pages.every(page => page.eq.mock.calls.some(call => call[0] === "couple_id" && call[1] === "ours"))).toBe(true);
  });
  it("rejects a partially failed read instead of treating saved trips as empty", async () => {
    mocks.client.mockResolvedValue({ from: () => query(null, { message: "private provider detail" }) });
    await expect(listTripDrafts()).rejects.toThrow("날짜별 여행을 불러오지 못했어요");
  });
  it("does not access the database for an unauthenticated workspace", async () => {
    mocks.session.mockResolvedValue({ mode: "anonymous" }); expect(await listTripDrafts()).toEqual([]); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("opens a saved date with the active plan's global revision without any write", async () => {
    const { client } = clientFor();
    expect(await readTripDate(draft.scheduled_on)).toMatchObject({ plan: { persist: true, revision: 8, startDate: draft.scheduled_on, title: draft.title, items: draft.items }, drafts: expect.arrayContaining([expect.objectContaining({ startDate: active.start_date })]) });
    expect(client.rpc).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("opens an empty date without cloning the active itinerary", async () => {
    const { client } = clientFor();
    expect((await readTripDate("2026-12-01")).plan).toEqual({ persist: true, revision: 8, startDate: "2026-12-01", title: "우리가 고른 여행", notes: "", items: [], dayCount: 1 });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("reads an undated draft and treats a matching active date as authoritative", async () => {
    clientFor([{ ...draft, scheduled_on: null }, { ...draft, scheduled_on: active.start_date }]);
    expect((await readTripDate(null)).plan).toMatchObject({ startDate: null, title: draft.title, items: draft.items });
    expect((await readTripDate(active.start_date)).plan).toMatchObject({ title: active.title, items: [item], revision: 8 });
  });
  it("validates a requested date before session or database reads", async () => {
    await expect(readTripDate("2026-02-30")).rejects.toThrow("날짜를 확인"); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("discards a mixed draft snapshot when a partner saves between the raw revision reads", async () => {
    const { client } = clientFor(); let planReads = 0;
    client.from.mockImplementation((table: string) => table === "couples" ? query(null, legacySchema) : query(table === "plans"
      ? { ...active, revision_id: ++planReads === 3 ? 9 : 8 } : table === "trip_drafts" ? [draft] : [activeItem]));
    await expect(readTripDate(draft.scheduled_on)).rejects.toThrow("조회하는 동안 파트너가 여행을 변경");
    expect(planReads).toBe(3); expect(client.rpc).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("rejects a cached active plan older than the stable raw revision without retrying the same cache", async () => {
    const { client } = clientFor(); let planReads = 0;
    client.from.mockImplementation((table: string) => table === "couples" ? query(null, legacySchema) : query(table === "plans"
      ? { ...active, revision_id: ++planReads === 2 ? 8 : 9 } : table === "trip_drafts" ? [draft] : [activeItem]));
    await expect(readTripDate()).rejects.toThrow("다시 조회해 주세요");
    expect(planReads).toBe(3); expect(client.rpc).not.toHaveBeenCalled();
  });
  it("accepts revision zero when both raw reads and the undated empty active plan have no row", async () => {
    const { client, queries } = clientFor([], null);
    expect((await readTripDate(null)).plan).toMatchObject({ persist: true, revision: 0, startDate: null, items: [] });
    expect(queries.filter(entry => entry.table === "plans")).toHaveLength(3);
    for (const entry of queries.filter(entry => entry.table === "plans")) {
      expect(entry.query.eq).toHaveBeenCalledWith("couple_id", "ours");
      expect(entry.query.eq).toHaveBeenCalledWith("kind", "trip");
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("rejects an initial raw revision read failure before returning a misleading empty travel", async () => {
    const { client } = clientFor(); client.from.mockReturnValueOnce(query(null, legacySchema)).mockReturnValueOnce(query(null, { message: "private provider detail" }));
    await expect(readTripDate(null)).rejects.toThrow("최신 상태를 확인하지 못했어요");
    expect(client.from).toHaveBeenCalledTimes(2); expect(client.rpc).not.toHaveBeenCalled();
  });
  it("infers supported trip days from stored items and ignores malformed JSON places", async () => {
    clientFor([{ ...draft, day_count: 1, items: [{ ...item, dayIndex: 2 }, { ...item, id: "invalid", placeName: "", dayIndex: 99 }] }]);
    expect(await listTripDrafts()).toEqual([expect.objectContaining({ dayCount: 3, items: [{ ...item, dayIndex: 2 }] })]);
  });
});
describe("explicit trip date changes", () => {
  it("sends the authenticated workspace, exact revision and optional approved target stamp to one atomic RPC", async () => {
    const { client } = clientFor();
    expect(await rescheduleTripPlan({ startDate: draft.scheduled_on, expectedRevision: 8, expectedTargetUpdatedAt: draft.updated_at })).toEqual({ ok: true, revision: 9 });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("reschedule_couple_trip", { target_start_date: draft.scheduled_on, expected_revision: 8, expected_target_updated_at: draft.updated_at, expected_couple_id: "ours" });
    expect(client.from).not.toHaveBeenCalled(); expect(mocks.revalidate).toHaveBeenCalledWith("/calendar");
  });
  it("does not implicitly approve replacement of an occupied date", async () => {
    const { client } = clientFor(); client.rpc.mockResolvedValue({ data: null, error: { message: "TRIP_DATE_OCCUPIED secret internal row" } });
    expect(await rescheduleTripPlan({ startDate: draft.scheduled_on, expectedRevision: 8 })).toMatchObject({ error: expect.stringContaining("다시 확인"), conflict: true });
    expect(client.rpc.mock.calls[0][1].expected_target_updated_at).toBeNull(); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(["PLAN_CONFLICT", "WORKSPACE_CHANGED"])("requires a fresh workspace on %s without showing raw provider details", async message => {
    const { client } = clientFor(); client.rpc.mockResolvedValue({ data: null, error: { message: `${message} internal private ID` } });
    const result = await rescheduleTripPlan({ startDate: draft.scheduled_on, expectedRevision: 8 });
    expect(result).toHaveProperty("conflict", true); expect((result as { error: string }).error).not.toContain("internal"); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("preserves current content on ordinary RPC failure without mislabeling it as a partner conflict", async () => {
    const { client } = clientFor(); client.rpc.mockResolvedValue({ data: null, error: { message: "network private credentials" } });
    expect(await rescheduleTripPlan({ startDate: draft.scheduled_on, expectedRevision: 8 })).toMatchObject({ error: expect.stringContaining("현재 여행은 그대로"), conflict: false }); expect(client.from).not.toHaveBeenCalled();
  });
  it.each([{ startDate: "2026-02-30", expectedRevision: 8 }, { startDate: draft.scheduled_on, expectedRevision: -1 }, { startDate: draft.scheduled_on, expectedRevision: 1.5 }, { startDate: draft.scheduled_on, expectedRevision: 8, expectedTargetUpdatedAt: "bad" }])("validates dates, revision and replacement stamp before a write: %j", async input => {
    expect(await rescheduleTripPlan(input)).toHaveProperty("error"); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects date changes without authentication", async () => {
    mocks.session.mockResolvedValue({ mode: "anonymous" }); expect(await rescheduleTripPlan({ startDate: draft.scheduled_on, expectedRevision: 8 })).toHaveProperty("error"); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("adds a place to the requested dated travel draft rather than the active trip", async () => {
    const { client } = clientFor(); const next = { ...item, id: "new", placeId: "new", placeName: "새 장소", dayIndex: 1 };
    expect(await addItemToCouplePlan("trip", next, { targetDate: draft.scheduled_on })).toMatchObject({ ok: true, items: [draft.items[0], expect.objectContaining({ id: "new", dayIndex: 1 })] });
    expect(client.rpc).toHaveBeenCalledWith("save_couple_plan_atomic", expect.objectContaining({ target_start_date: draft.scheduled_on, target_day_count: 2, target_title: draft.title, target_subtitle: draft.notes, expected_revision: 8, expected_couple_id: "ours" }));
  });
  it("adds to an explicitly selected undated draft without copying the active dated travel", async () => {
    const { client } = clientFor([{ ...draft, scheduled_on: null }]); const next = { ...item, id: "new", placeId: "new" };
    await addItemToCouplePlan("trip", next, { targetDate: "" });
    expect(client.rpc).toHaveBeenCalledWith("save_couple_plan_atomic", expect.objectContaining({ target_start_date: null, target_title: draft.title, target_day_count: 2 }));
  });
  it("detects a partner connection change in regular plan saves too", async () => {
    const { client } = clientFor(); client.rpc.mockResolvedValue({ data: null, error: { message: "WORKSPACE_CHANGED internal id" } });
    expect(await saveCouplePlan("trip", [item], { expectedRevision: 8 })).toMatchObject({ conflict: true, error: expect.stringContaining("새 공간") });
  });
});
describe("travel records retain their original calendar range", () => {
  it("retains the original undated identity and infers days from the recorded places", async () => {
    const memory = query({ id: "record" }); mocks.client.mockResolvedValue({ from: vi.fn(() => memory) });
    expect(await archiveTripPlan({ title: "날짜 미정 여행", startDate: "", dayCount: 1, items: [{ ...item, dayIndex: 2 }] })).toEqual({ ok: true, id: "record" });
    expect(memory.insert).toHaveBeenCalledWith(expect.objectContaining({ description: "3일 · 1곳" }));
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ afterValue: expect.objectContaining({ startDate: "", dayCount: 3 }) }));
  });
  it.each(["returned", "thrown"])("removes only its own partial record when snapshot storage fails (%s)", async failure => {
    const memory = query({ id: "record" }); const rollback = query(null);
    mocks.client.mockResolvedValue({ from: vi.fn().mockReturnValueOnce(memory).mockReturnValueOnce(rollback) });
    if (failure === "returned") mocks.activity.mockResolvedValue({ error: "snapshot failed" }); else mocks.activity.mockRejectedValue(new Error("snapshot offline"));
    expect(await archiveTripPlan({ title: "기록", startDate: active.start_date, dayCount: 3, items: [item] })).toHaveProperty("error");
    expect(rollback.delete).toHaveBeenCalledTimes(1); expect(rollback.eq).toHaveBeenCalledWith("id", "record"); expect(rollback.eq).toHaveBeenCalledWith("couple_id", "ours"); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("reads an original undated record without inventing a dated trip from the memory creation date", async () => {
    const from = vi.fn().mockReturnValueOnce(query([{ id: "record", title: "날짜 미정", happened_on: "2026-10-11", description: "3일" }]))
      .mockReturnValueOnce(query([{ entity_id: "record", after_value: { startDate: "", dayCount: 1, items: [{ ...item, dayIndex: 2 }] } }]));
    mocks.client.mockResolvedValue({ from });
    expect(await listArchivedTripPlans()).toEqual([expect.objectContaining({ startDate: "", dayCount: 3, status: "completed" })]);
  });
  it("rejects an empty travel record before creating a memory", async () => {
    const { client } = clientFor(); expect(await archiveTripPlan({ title: "비어 있음", startDate: active.start_date, dayCount: 3, items: [] })).toHaveProperty("error"); expect(client.from).not.toHaveBeenCalled();
  });
});
