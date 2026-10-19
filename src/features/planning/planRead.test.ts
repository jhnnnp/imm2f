import { beforeEach, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
import { loadCouplePlan } from "./actions";

const request = vi.fn<typeof fetch>();
const row = {
  client_id: "first", place_id: "manual-cafe", place_name: "우리 카페", category: "카페", start_time: "13:00",
  duration_minutes: 60, expected_cost: 10000, sort_order: 0, memo: "", day_index: 0, lng: 127, lat: 37,
};
const plan = { id: "plan", kind: "trip", title: "함께 가는 여행", subtitle: "여행 메모", start_date: "2026-11-01", day_count: 2, revision_id: 8 };
function respond(data: unknown, status = 200) {
  request.mockResolvedValueOnce(Response.json(data, { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", userId: "me", coupleId: "ours", displayName: "나", partner: null });
  mocks.client.mockResolvedValue(createSupabaseClient<Database>("https://provider.example", "public", {
    auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false }, global: { fetch: request },
  }));
});

it("reads plan metadata, revision and ordered itinerary with one scoped provider request", async () => {
  respond([{ ...plan, plan_items: [{ ...row, client_id: "last", day_index: 1 }, { ...row, client_id: "second", sort_order: 1 }, row] }]);
  const result = await loadCouplePlan("trip");
  expect(result).toMatchObject({ persist: true, revision: 8, title: plan.title, startDate: plan.start_date, dayCount: 2 });
  expect(result.items.map(item => item.id)).toEqual(["first", "second", "last"]);
  expect(result.items[0].coordinates).toEqual([127, 37]);
  expect(request).toHaveBeenCalledTimes(1);
  const url = new URL(String(request.mock.calls[0][0]));
  expect(url.pathname).toBe("/rest/v1/plans");
  expect(url.searchParams.get("couple_id")).toBe("eq.ours");
  expect(url.searchParams.get("kind")).toBe("eq.trip");
  expect(url.searchParams.get("select")).toContain("plan_items(");
});

it("keeps an empty itinerary and an absent plan to one request", async () => {
  respond([{ ...plan, plan_items: [] }]);
  expect(await loadCouplePlan("date")).toMatchObject({ persist: true, revision: 8, items: [] });
  respond([]);
  expect(await loadCouplePlan("trip")).toMatchObject({ persist: true, revision: 0, items: [] });
  expect(request).toHaveBeenCalledTimes(2);
});

it("supports a stale relationship cache with the existing separately scoped read", async () => {
  respond({ code: "PGRST200", message: "Relationship missing in schema cache" }, 400);
  respond([plan]);
  respond([row]);
  expect(await loadCouplePlan("trip")).toMatchObject({ revision: 8, items: [expect.objectContaining({ id: "first" })] });
  expect(request).toHaveBeenCalledTimes(3);
  const itemUrl = new URL(String(request.mock.calls[2][0]));
  expect(itemUrl.pathname).toBe("/rest/v1/plan_items");
  expect(itemUrl.searchParams.get("plan_id")).toBe("eq.plan");
});

it("does not fan out fallback reads on a provider outage", async () => {
  respond({ code: "503", message: "Provider unavailable" }, 503);
  await expect(loadCouplePlan("trip")).rejects.toThrow("일정을 불러오지 못했어요");
  expect(request).toHaveBeenCalledTimes(1);
});

it("never reads another workspace when authentication is absent", async () => {
  mocks.session.mockResolvedValue({ mode: "guest" });
  expect(await loadCouplePlan("trip")).toMatchObject({ persist: false, items: [] });
  expect(mocks.client).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
