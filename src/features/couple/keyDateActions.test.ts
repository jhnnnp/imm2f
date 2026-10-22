import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), from: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), eq: vi.fn(), result: {} as { data: unknown; error: unknown } }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { readCoupleKeyDates, saveCoupleKeyDates } from "./keyDateActions";
const scope = { coupleId: "couple-a", userId: "user-a" };
const dates = { relationshipStartedOn: "2020-01-01", birthdays: [{ id: "d9e5de9c-55b8-48bb-8d91-aa948c35b3d0", name: "명시한 이름", date: "2000-02-29" }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", ...scope, partner: null });
  mocks.result = { data: { relationship_started_on: dates.relationshipStartedOn, birthdays: dates.birthdays, revision: 2, onboarding_completed: true }, error: null };
  const query = { select: () => query, eq: mocks.eq, maybeSingle: async () => mocks.result };
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query); mocks.rpc.mockReturnValue(query);
  mocks.client.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
});
it("scopes both partners' reads to their actual shared couple and preserves birthday identities", async () => {
  const first = await readCoupleKeyDates();
  mocks.session.mockResolvedValue({ mode: "authenticated", ...scope, userId: "user-b", partner: null });
  const second = await readCoupleKeyDates();
  expect(first.dates).toEqual(dates); expect(second.dates).toEqual(first.dates);
  expect(mocks.eq).toHaveBeenCalledWith("couple_id", "couple-a");
});
it("keeps an empty authenticated workspace available for optional onboarding", async () => {
  mocks.result = { data: null, error: null };
  expect(await readCoupleKeyDates()).toMatchObject({ persist: true, revision: 0, onboardingCompleted: false, dates: { relationshipStartedOn: null, birthdays: [] } });
});
it("does not turn a read outage into an empty editable record", async () => {
  mocks.result = { data: null, error: { code: "503" } };
  await expect(readCoupleKeyDates()).rejects.toThrow("불러오지 못했어요");
  mocks.result = { data: null, error: { code: "PGRST205" } };
  expect(await readCoupleKeyDates()).toMatchObject({ persist: false });
});
it.each([{ coupleId: "old-couple", userId: scope.userId }, { coupleId: scope.coupleId, userId: "old-user" }])("rejects stale scope before database access %j", async stale => {
  expect(await saveCoupleKeyDates({ dates, expectedRevision: 2, scope: stale })).toMatchObject({ conflict: true });
  expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not save malformed or unauthenticated dates", async () => {
  expect(await saveCoupleKeyDates({ dates: { ...dates, relationshipStartedOn: "2026-02-30" }, expectedRevision: 2, scope })).toHaveProperty("error");
  expect(mocks.session).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ mode: "guest" });
  expect(await saveCoupleKeyDates({ dates, expectedRevision: 2, scope })).toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("passes the exact revision and stable identities to the atomic save then refreshes calendar", async () => {
  mocks.result.data = { revision: 3, onboarding_completed: true };
  expect(await saveCoupleKeyDates({ dates, expectedRevision: 2, scope })).toMatchObject({ ok: true, snapshot: { dates, revision: 3 } });
  expect(mocks.rpc).toHaveBeenCalledWith("save_couple_key_dates", { target_couple: "couple-a", expected_revision: 2,
    started_on: dates.relationshipStartedOn, birthday_entries: dates.birthdays, complete_onboarding: true });
  expect(mocks.revalidate).toHaveBeenCalledWith("/calendar");
});
it("reports a concurrent partner edit without overwriting or revalidating", async () => {
  mocks.result = { data: null, error: { code: "P0001", message: "key dates conflict" } };
  expect(await saveCoupleKeyDates({ dates, expectedRevision: 2, scope })).toMatchObject({ conflict: true });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("accepts the committed revision returned by an exact lost-response retry", async () => {
  mocks.result.data = { revision: 3, onboarding_completed: true };
  const result = await saveCoupleKeyDates({ dates, expectedRevision: 2, scope });
  expect(result).toMatchObject({ ok: true, snapshot: { revision: 3, dates } });
  expect(mocks.rpc.mock.calls[0][1].expected_revision).toBe(2);
});
