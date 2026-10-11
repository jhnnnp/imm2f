import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getAppSession: vi.fn(), revalidate: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.getAppSession }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn() }));
import { updateMemory } from "./actions";
import type { UpdateMemoryInput } from "./types";
const attemptId = "11111111-1111-4111-8111-111111111111";
const id = "33333333-3333-4333-8333-333333333333";
const coupleId = "22222222-2222-4222-8222-222222222222";
const input: UpdateMemoryInput = { id, attemptId, title: "우리 기록", happenedOn: "2026-10-11",
  description: "그날", locationLabel: "서울", memoryType: "free", lng: null, lat: null,
  expectedSnapshot: JSON.stringify(["우리 기록", "2026-10-11", "그날", "서울", "free", null]) };
const row = { id, couple_id: coupleId, created_by: "user", title: input.title,
  happened_on: input.happenedOn, description: input.description, location_label: input.locationLabel,
  memory_type: "free", place_id: null, lng: null, lat: null, created_at: "2026-10-11T00:00:00Z" };
const rpc = vi.fn();
const from = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppSession.mockResolvedValue({ mode: "authenticated", userId: "user", coupleId, displayName: "나", partner: null });
  mocks.createClient.mockResolvedValue({ rpc, from });
  rpc.mockResolvedValue({ data: { replayed: false, memory: row, photos: [] }, error: null });
});
it("sends a stable attempt and original snapshot in the single atomic edit", async () => {
  expect(await updateMemory(input)).toHaveProperty("memory.id", id);
  expect(rpc).toHaveBeenCalledWith("update_memory_atomic", expect.objectContaining({ target_attempt: attemptId,
    target_id: id, target_couple: coupleId, target_expected: JSON.parse(input.expectedSnapshot!),
    target_memory: expect.objectContaining({ title: input.title }), target_photos: [] }));
  expect(from).not.toHaveBeenCalled();
});
it("acknowledges a photo-only replay without uploading or inserting a second time", async () => {
  const photoInput = { ...input, photos: [{ storagePath: `${coupleId}/same-photo.jpg` }] };
  rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  expect(await updateMemory(photoInput)).toMatchObject({ keepUploadedPhotos: true });
  rpc.mockResolvedValueOnce({ data: { replayed: true, memory: row, photos: [] }, error: null });
  expect(await updateMemory(photoInput)).toHaveProperty("memory.id", id);
  expect(rpc.mock.calls.map(call => call[1].target_attempt)).toEqual([attemptId, attemptId]);
  expect(rpc.mock.calls[0][1].target_photos).toEqual(rpc.mock.calls[1][1].target_photos);
  expect(from).not.toHaveBeenCalled();
});
it("returns the current partner edits when an earlier successful attempt is replayed", async () => {
  rpc.mockResolvedValue({ data: { replayed: true, memory: { ...row, title: "파트너의 후속 수정" }, photos: [] }, error: null });
  expect(await updateMemory(input)).toHaveProperty("memory.title", "파트너의 후속 수정");
});
it("retains uploaded files on an ambiguous PostgREST response", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "response lost" } });
  expect(await updateMemory(input)).toMatchObject({ keepUploadedPhotos: true });
});
it.each(["22023", "42501", "23503", "23505", "PGRST202"])("allows correction after definite rejection %s", async code => {
  rpc.mockResolvedValue({ data: null, error: { code, message: "rejected" } });
  const result = await updateMemory(input);
  expect(result).toHaveProperty("error");
  expect(result).not.toHaveProperty("keepUploadedPhotos", true);
  expect(from).not.toHaveBeenCalled();
});
it("does not report an unrelated SQL exception as a known snapshot conflict", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "an unrelated trigger failed" } });
  const result = await updateMemory(input);
  expect(result).toMatchObject({ keepUploadedPhotos: true });
  expect(result).not.toHaveProperty("conflict", true);
});
it.each(["P0001", "P0002"])("reports known conflict/deletion %s without deleting acknowledged files", async code => {
  rpc.mockResolvedValue({ data: null, error: { code, message: code === "P0001" ? "Memory edit conflict" : "Memory no longer exists" } });
  const result = await updateMemory(input);
  expect(result).toMatchObject({ conflict: true });
  expect(result).not.toHaveProperty("keepUploadedPhotos", true);
});
it.each([undefined, "invalid", "11111111-1111-1111-1111-111111111111"])("rejects invalid attempt ID %s", async attemptId => {
  expect(await updateMemory({ ...input, attemptId })).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
it.each([undefined, "older-editor-snapshot", "[]"])("requires a valid original snapshot %s", async expectedSnapshot => {
  expect(await updateMemory({ ...input, expectedSnapshot })).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
it.each([[null, 37], [181, 37], [127, Number.NaN]])("rejects partial or invalid coordinates %s before saving", async (lng, lat) => {
  expect(await updateMemory({ ...input, lng, lat })).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves the edit when the returned photos belong to a different memory", async () => {
  rpc.mockResolvedValue({ data: { memory: row, photos: [{ memory_id: "other-memory" }] }, error: null });
  expect(await updateMemory(input)).toMatchObject({ keepUploadedPhotos: true });
});
it("does not call the edit RPC for unauthenticated requests", async () => {
  mocks.getAppSession.mockResolvedValue({ mode: "guest" });
  expect(await updateMemory(input)).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});
