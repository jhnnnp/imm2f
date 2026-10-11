import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanItem } from "./types/plan";

const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn(), email: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: vi.fn(), queuePartnerEmail: mocks.email }));

import { addItemToCouplePlan, openDateDay, saveCouplePlan, saveDateDraft } from "./actions";

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const methods = ["insert", "upsert", "delete", "select", "eq", "in", "order", "maybeSingle", "single"];
  const chain: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result> = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  } as never;
  for (const method of methods) chain[method] = vi.fn(() => chain);
  return chain;
}

const item: PlanItem = { id: "one", placeId: "place", placeName: "새 카페", category: "카페", startTime: "13:00", durationMinutes: 60, expectedCost: 10000, order: 0, dayIndex: 0, memo: "", coordinates: [127, 37] };
const plan = { id: "plan", kind: "date", title: "첫 날짜", subtitle: "첫 메모", start_date: "2026-10-11", day_count: 1, revision_id: 4 };
const row = { client_id: "old", place_id: "old", place_name: "첫 날짜 장소", category: "카페", start_time: "10:00", duration_minutes: 60, expected_cost: 0, sort_order: 0, memo: "", day_index: 0, lng: 127, lat: 37 };

function db(...queries: ReturnType<typeof query>[]) {
  const from = vi.fn();
  for (const result of queries) from.mockReturnValueOnce(result);
  const client = { from, rpc: vi.fn().mockResolvedValue({ data: { plan_id: "plan", revision: 5, version: 5 }, error: null }) };
  mocks.client.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", coupleId: "ours", userId: "me", displayName: "나", partner: null });
  mocks.email.mockResolvedValue(undefined);
});

describe("planner data boundaries and committed results", () => {
  it("adds to the requested date's draft instead of the globally active date", async () => {
    const targetStop = { ...item, id: "target", placeId: "target", placeName: "둘째 날짜 장소" };
    const preserved = query(null);
    const client = db(query(plan), query([row]), query([{ scheduled_on: "2026-10-12", title: "둘째 날짜", notes: "둘째 메모", items: [targetStop] }]), query(plan), query([row]), preserved);
    const result = await addItemToCouplePlan("date", item, { targetDate: "2026-10-12" });
    expect(result).toMatchObject({ ok: true, duplicate: false, items: [targetStop, expect.objectContaining({ placeName: "새 카페" })] });
    expect(client.rpc).toHaveBeenCalledWith("save_couple_plan_atomic", expect.objectContaining({ target_title: "둘째 날짜", target_subtitle: "둘째 메모", target_start_date: "2026-10-12", expected_revision: 4 }));
    expect(preserved.upsert).toHaveBeenCalledWith(expect.objectContaining({ scheduled_on: "2026-10-11", title: "첫 날짜" }), expect.anything());
  });

  it("returns the advanced revision without a fallible secondary write when opening a date", async () => {
    const client = db(query(plan), query([row]), query([]), query(null), query(plan), query([row]), query(null, { message: "draft connection failed" }));
    const result = await openDateDay({ fromDate: "2026-10-11", toDate: "2026-10-12", expectedRevision: 4, snapshot: { title: "수정된 첫 날짜", notes: "메모", items: [item] } });
    expect(result).toMatchObject({ ok: true, revision: 5, focus: { date: "2026-10-12" } });
    expect(client.from).toHaveBeenCalledTimes(6);
    expect(client.from.mock.calls.filter(([table]) => table === "date_drafts")).toHaveLength(2);
  });

  it("keeps a committed save successful when email queuing is unavailable", async () => {
    db(query(plan), query([row]));
    mocks.email.mockRejectedValue(new Error("email queue offline"));
    await expect(saveCouplePlan("date", [item], { expectedRevision: 4 })).resolves.toEqual({ ok: true, revision: 5, version: 5 });
  });

  it("rejects invalid metadata before querying or writing", async () => {
    const client = db();
    expect(await saveCouplePlan("trip", [item], { startDate: "2026-02-30" })).toHaveProperty("error");
    expect(await saveCouplePlan("trip", [item], { dayCount: 1.5 })).toHaveProperty("error");
    expect(await saveCouplePlan("trip", [item], { title: 123 as unknown as string })).toHaveProperty("error");
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed date snapshots before writing them into JSON drafts", async () => {
    const client = db();
    expect(await saveDateDraft({ date: "2026-10-12", title: "데이트", notes: "", items: [item, item] })).toHaveProperty("error");
    expect(await saveDateDraft({ date: "2026-02-30", title: "데이트", notes: "", items: [item] })).toHaveProperty("error");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid date switch and trip day before a read or mutation", async () => {
    const client = db();
    expect(await openDateDay({ fromDate: "2026-10-11", toDate: "invalid", expectedRevision: 4, snapshot: { title: "데이트", notes: "", items: [item] } })).toHaveProperty("error");
    expect(await addItemToCouplePlan("trip", { ...item, dayIndex: NaN })).toHaveProperty("error");
    expect(await addItemToCouplePlan("date", item, { targetDate: "2026-02-30" })).toHaveProperty("error");
    expect(client.from).not.toHaveBeenCalled();
  });
});
