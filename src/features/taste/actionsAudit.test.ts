import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TasteInput } from "./types";

const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), activity: vi.fn(), email: vi.fn(), revalidate: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity, queuePartnerEmail: mocks.email }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn() }));
import { saveTasteProfile } from "./actions";
import { parseTasteInput, parseTasteProfile } from "./parse";

const input: TasteInput = {
  areas: ["성수동"], pace: "linger", activities: ["meal", "cafe"], cuisines: ["한식"], avoidFoods: ["매운 음식"],
  setting: "mix", crowd: "quiet", budget: "comfortable", timeWindow: "evening", areaScope: "walkable",
  dateFlow: "flex", drink: "none", indoorPlay: "", note: "천천히",
};
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "single"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", userId: "you", coupleId: "couple", displayName: "나", partner: { userId: "partner", displayName: "파트너" } });
  mocks.activity.mockResolvedValue({ ok: true });
  mocks.email.mockResolvedValue(undefined);
});

describe("taste action validation and committed replies", () => {
  it("accepts a profile with no budget and ignores the old field when loading or parsing", () => {
    const { budget: _oldBudget, ...withoutBudget } = input;
    expect(parseTasteInput(withoutBudget)).toMatchObject({ areas: ["성수"], pace: "linger" });
    expect(parseTasteInput(withoutBudget)).not.toHaveProperty("budget");
    expect(parseTasteProfile({ ...input, budget: "generous" })).not.toHaveProperty("budget");
  });
  it.each([null, {}, [], { ...input, activities: null }, { ...input, activities: "meal" }, { ...input, areas: [null] }, { ...input, note: {} }, { ...input, cuisines: ["unknown"] }])("rejects malformed user payloads before any backend access", async value => {
    expect(await saveTasteProfile(value as TasteInput)).toHaveProperty("error");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ ...input, areas: Array(5).fill("성수") }, { ...input, note: "a".repeat(161) }, { ...input, avoidFoods: ["a".repeat(17)] }, { ...input, indoorPlay: "a".repeat(21) }])("rejects oversized fields before any backend access", async value => {
    expect(await saveTasteProfile(value)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("keeps a successfully stored profile when both optional notifications reject", async () => {
    const read = query({ data: [], error: null });
    const write = query({ data: { user_id: "you" }, error: null });
    const from = vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(write);
    mocks.client.mockResolvedValue({ from });
    mocks.activity.mockRejectedValue(new Error("activity offline"));
    mocks.email.mockRejectedValue(new Error("email offline"));
    expect(await saveTasteProfile(input)).toMatchObject({ you: { areas: ["성수"], note: "천천히" }, partner: null });
    expect(write.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "you", couple_id: "couple" }), { onConflict: "couple_id,user_id" });
    expect(mocks.revalidate).toHaveBeenCalledWith("/date");
  });
  it("does not overwrite or notify twice when retrying an already committed identical profile", async () => {
    const current = parseTasteInput(input);
    expect(current).not.toHaveProperty("error");
    const read = query({ data: [{ ...current, user_id: "you" }], error: null });
    const from = vi.fn(() => read);
    mocks.client.mockResolvedValue({ from });
    expect(await saveTasteProfile(input)).toMatchObject({ you: { areas: ["성수"], note: "천천히" } });
    expect(from).toHaveBeenCalledTimes(1);
    expect(read.upsert).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("does not notify or claim a save when the database rejects the write", async () => {
    mocks.client.mockResolvedValue({ from: vi.fn().mockReturnValueOnce(query({ data: [], error: null })).mockReturnValueOnce(query({ data: null, error: { code: "42501" } })) });
    expect(await saveTasteProfile(input)).toHaveProperty("error");
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("does not turn arbitrary stored objects into a fake area string", () => {
    expect(parseTasteProfile({ ...input, areas: [{}], time_window: "evening" })).toBeNull();
  });
});
