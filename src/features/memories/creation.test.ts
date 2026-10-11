import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getAppSession: vi.fn(), revalidate: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.getAppSession }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn() }));
import { createMemory } from "./actions";
const attemptId = "11111111-1111-4111-8111-111111111111";
const coupleId = "22222222-2222-4222-8222-222222222222";
const input = { attemptId, title: "우리 기록", happenedOn: "2026-10-11", description: "그날", locationLabel: "서울" };
const row = { id: attemptId, couple_id: coupleId, created_by: "user", title: input.title,
  happened_on: input.happenedOn, description: input.description, location_label: input.locationLabel,
  memory_type: "free", place_id: null, lng: null, lat: null, created_at: "2026-10-11T00:00:00Z" };
const rpc = vi.fn();
const from = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppSession.mockResolvedValue({ mode: "authenticated", userId: "user", coupleId, displayName: "나", partner: null });
  mocks.createClient.mockResolvedValue({ rpc, from });
  rpc.mockResolvedValue({ data: { created: true, memory: row, photos: [] }, error: null });
});
it("sends the stable attempt and caller's couple in one atomic creation request", async () => {
  expect(await createMemory(input)).toHaveProperty("memory.id", attemptId);
  expect(rpc).toHaveBeenCalledWith("create_memory_atomic", expect.objectContaining({ target_id: attemptId,
    target_couple: coupleId, target_memory: expect.objectContaining({ title: input.title }), target_photos: [] }));
  expect(from).not.toHaveBeenCalled();
});
it("reuses the same ID when confirming a creation after a lost reply", async () => {
  rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  expect(await createMemory(input)).toMatchObject({ keepUploadedPhotos: true });
  rpc.mockResolvedValueOnce({ data: { created: false, memory: row, photos: [] }, error: null });
  expect(await createMemory(input)).toHaveProperty("memory.id", attemptId);
  expect(rpc.mock.calls.map(call => call[1].target_id)).toEqual([attemptId, attemptId]);
  expect(from).not.toHaveBeenCalled();
});
it("does not discard uploaded files on an ambiguous server failure", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "response lost" } });
  expect(await createMemory(input)).toMatchObject({ keepUploadedPhotos: true });
});
it.each(["22023", "42501", "23503", "PGRST202"])("allows editing after a definite transaction rejection %s", async code => {
  rpc.mockResolvedValue({ data: null, error: { code, message: "rejected" } });
  const result = await createMemory(input);
  expect(result).toHaveProperty("error");
  expect(result).not.toHaveProperty("keepUploadedPhotos", true);
});
it("never inserts through a nonatomic fallback if the RPC is unavailable", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing function" } });
  await createMemory(input);
  expect(from).not.toHaveBeenCalled();
});
it.each([undefined, "invalid", "11111111-1111-1111-1111-111111111111"])("rejects missing or invalid attempt IDs %s before writing", async id => {
  expect(await createMemory({ ...input, attemptId: id })).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
it("rejects a malformed response so the composer can safely confirm again", async () => {
  rpc.mockResolvedValue({ data: { memory: { ...row, id: "wrong" }, photos: [] }, error: null });
  expect(await createMemory(input)).toMatchObject({ keepUploadedPhotos: true });
});
