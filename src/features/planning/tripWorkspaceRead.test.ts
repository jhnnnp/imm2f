import { beforeEach, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
import { readTripDate } from "./actions";

const request = vi.fn<typeof fetch>();
const place = { client_id: "first", place_id: "manual-cafe", place_name: "우리 카페", category: "카페", start_time: "13:00",
  duration_minutes: 60, expected_cost: 10000, sort_order: 0, memo: "", day_index: 0, lng: 127, lat: 37 };
const plan = { id: "plan", kind: "trip", title: "함께 가는 여행", subtitle: "체크인 16시", start_date: "2026-11-01", day_count: 2, revision_id: 8, plan_items: [place] };
const draft = { scheduled_on: "2026-12-01", title: "겨울 여행", notes: "바다", day_count: 1, items: [], updated_at: "2026-10-19T00:00:00Z" };
const snapshot = { id: "ours", plans: [plan], trip_drafts: [draft] };
const respond = (data: unknown, status = 200) => Response.json(data, { status });
const urls = () => request.mock.calls.map(call => new URL(String(call[0])));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", userId: "me", coupleId: "ours", displayName: "나", partner: null });
  mocks.client.mockResolvedValue(createSupabaseClient<Database>("https://provider.example", "public", {
    auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false }, global: { fetch: request },
  }));
});

it("reads the active revision, ordered itinerary and saved dates in one scoped database snapshot", async () => {
  request.mockResolvedValueOnce(respond([{ ...snapshot, plans: [{ ...plan, plan_items: [
    { ...place, client_id: "last", day_index: 1 }, { ...place, client_id: "second", sort_order: 1 }, place,
  ] }], trip_drafts: [{ ...draft, scheduled_on: plan.start_date, title: "Older active draft" }, draft] }]));
  const result = await readTripDate();
  expect(result.plan).toMatchObject({ persist: true, revision: 8, title: plan.title, startDate: plan.start_date, notes: plan.subtitle });
  expect(result.plan.items.map(item => item.id)).toEqual(["first", "second", "last"]);
  expect(result.drafts.find(item => item.startDate === plan.start_date)?.title).toBe(plan.title);
  expect(result.drafts.find(item => item.startDate === draft.scheduled_on)).toMatchObject({ title: draft.title, updatedAt: draft.updated_at });
  expect(request).toHaveBeenCalledTimes(1);
  const url = urls()[0];
  expect(url.pathname).toBe("/rest/v1/couples");
  expect(url.searchParams.get("id")).toBe("eq.ours");
  expect(url.searchParams.get("plans.kind")).toBe("eq.trip");
  expect(url.searchParams.get("trip_drafts.limit")).toBe("1001");
  expect(url.searchParams.get("trip_drafts.order")).toBe("scheduled_on.asc");
  expect(url.searchParams.get("select")).toContain("plans(id,kind,title,subtitle,start_date,day_count,revision_id,plan_items(");
  expect(url.searchParams.get("select")).toContain("trip_drafts(scheduled_on,title,notes,day_count,items,updated_at)");
});

it("opens a saved date with the snapshot revision while preserving an undated draft", async () => {
  request.mockResolvedValueOnce(respond([{ ...snapshot, trip_drafts: [draft, { ...draft, scheduled_on: null, title: "날짜 미정" }] }]));
  const result = await readTripDate(draft.scheduled_on);
  expect(result.plan).toMatchObject({ revision: 8, title: draft.title, notes: draft.notes, startDate: draft.scheduled_on, items: [] });
  expect(result.drafts[0]).toMatchObject({ startDate: "", title: "날짜 미정" });
  expect(request).toHaveBeenCalledTimes(1);
});

it("preserves revision zero and an empty workspace when the authorized couple has no active plan", async () => {
  request.mockResolvedValueOnce(respond([{ ...snapshot, plans: [], trip_drafts: [] }]));
  expect(await readTripDate(null)).toMatchObject({ plan: { persist: true, revision: 0, startDate: null, items: [] }, drafts: [] });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([null, { ...snapshot, id: "other" }, { ...snapshot, plans: null }, { ...snapshot, trip_drafts: null },
  { ...snapshot, plans: [{ ...plan, revision_id: null }] }, { ...snapshot, trip_drafts: [null] },
])("rejects an absent or malformed provider snapshot instead of returning empty saved data: %j", async row => {
  request.mockResolvedValueOnce(respond(row ? [row] : []));
  await expect(readTripDate()).rejects.toThrow("여행");
  expect(request).toHaveBeenCalledTimes(1);
});

it("does not turn an outage into revision/draft fan-out requests", async () => {
  request.mockResolvedValueOnce(respond({ code: "503", message: "private provider detail" }, 503));
  await expect(readTripDate()).rejects.toThrow("최신 상태를 확인하지 못했어요");
  expect(request).toHaveBeenCalledTimes(1);
});

function legacyResponse(url: URL, drafts = [draft], afterRevision = 8) {
  if (url.pathname.endsWith("/plans")) return respond([{ ...plan, revision_id: url.searchParams.get("select") === "revision_id" ? afterRevision : 8 }]);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return respond(drafts.slice(offset, offset + 1000));
}

it.each(["PGRST200", "PGRST204"])("retains revision-bracketed consistency reads when nested schema is unavailable (%s)", async code => {
  request.mockImplementation(async input => {
    const url = new URL(String(input));
    return url.pathname.endsWith("/couples") ? respond({ code, message: "Old schema cache" }, 400) : legacyResponse(url);
  });
  expect((await readTripDate(draft.scheduled_on)).plan).toMatchObject({ revision: 8, title: draft.title });
  expect(urls().filter(url => url.searchParams.get("select") === "revision_id")).toHaveLength(2);
  expect(urls().filter(url => url.pathname.endsWith("/plans")).every(url => url.searchParams.get("couple_id") === "eq.ours" && url.searchParams.get("kind") === "eq.trip")).toBe(true);
});

it.each([1000, 1001])("paginates rather than trusting a possibly truncated %i-row embedded draft response", async size => {
  const drafts = Array.from({ length: 1001 }, (_, index) => ({ ...draft,
    scheduled_on: new Date(Date.UTC(2030, 0, index + 1)).toISOString().slice(0, 10), title: `여행 ${index}`,
  }));
  request.mockImplementation(async input => {
    const url = new URL(String(input));
    return url.pathname.endsWith("/couples") ? respond([{ ...snapshot, trip_drafts: drafts.slice(0, size) }]) : legacyResponse(url, drafts);
  });
  const result = await readTripDate();
  expect(result.drafts).toHaveLength(1002); // All 1001 drafts plus the active trip.
  expect(result.drafts.some(item => item.title === "여행 1000")).toBe(true);
  const pages = urls().filter(url => url.pathname.endsWith("/trip_drafts"));
  expect(pages.map(url => url.searchParams.get("offset"))).toEqual(["0", "1000"]);
  expect(pages.every(url => url.searchParams.get("couple_id") === "eq.ours")).toBe(true);
  expect(urls().filter(url => url.searchParams.get("select") === "revision_id")).toHaveLength(2);
});

it("rejects fallback data when a partner saves during the paginated read", async () => {
  let revisions = 0;
  request.mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/couples")) return respond({ code: "PGRST200", message: "Old schema cache" }, 400);
    if (url.searchParams.get("select") === "revision_id") revisions += 1;
    return legacyResponse(url, [draft], revisions > 1 ? 9 : 8);
  });
  await expect(readTripDate()).rejects.toThrow("파트너가 여행을 변경");
});

it("performs no database query without an authenticated session", async () => {
  mocks.session.mockResolvedValue({ mode: "guest" });
  expect(await readTripDate()).toMatchObject({ plan: { persist: false, revision: 0 }, drafts: [] });
  expect(request).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
});
