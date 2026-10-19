import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const mocks = vi.hoisted(() => ({ client: vi.fn(), session: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
import { listMemories } from "./actions";

const request = vi.fn<typeof fetch>();
const memory = { id: "memory", memory_type: "free", place_id: null, title: "우리의 하루", happened_on: "2026-10-18", description: "", location_label: "서울", lng: null, lat: null, created_by: "me", created_at: "2026-10-18T00:00:00Z" };
const photo = { id: "cover", memory_id: memory.id, storage_url: "https://images.example/cover.jpg", storage_path: null, caption: "", sort_order: 0 };
function respond(data: unknown, status = 200) { request.mockResolvedValueOnce(Response.json(data, { status })); }
function requestedUrl(index = 0) { return new URL(String(request.mock.calls[index][0])); }
function signature(path: string) {
  const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { path, signedURL: `/object/sign/memory-photos/${path}?token=header.${claims}.signature`, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", userId: "me", coupleId: "ours", displayName: "나", partner: null });
  mocks.client.mockResolvedValue(createSupabaseClient<Database>("https://provider.example", "public", {
    auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false }, global: { fetch: request },
  }));
});
afterEach(() => { vi.useRealTimers(); });

it("loads memories and their complete photo collections in a single scoped request", async () => {
  respond([{ ...memory, memory_photos: [{ ...photo, id: "second", sort_order: 1 }, photo] }]);
  const result = await listMemories();
  expect(result.memories[0].photos.map(item => item.id)).toEqual(["cover", "second"]);
  expect(result.memories[0].coverUrl).toBe(photo.storage_url);
  expect(request).toHaveBeenCalledTimes(1);
  expect(requestedUrl().searchParams.get("couple_id")).toBe("eq.ours");
  expect(requestedUrl().searchParams.get("select")).toContain("memory_photos(");
  expect(requestedUrl().searchParams.has("memory_photos.limit")).toBe(false);
});

it("limits cover reads to one ordered photo per memory instead of one photo overall", async () => {
  respond([{ ...memory, memory_photos: [photo] }, { ...memory, id: "other", memory_photos: [{ ...photo, id: "other-cover", memory_id: "other" }] }]);
  const result = await listMemories({ photos: "cover" });
  expect(result.memories.map(item => item.photos[0].id)).toEqual(["cover", "other-cover"]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(requestedUrl().searchParams.get("memory_photos.order")).toBe("sort_order.asc");
  expect(requestedUrl().searchParams.get("memory_photos.limit")).toBe("1");
  expect(requestedUrl().searchParams.has("limit")).toBe(false);
});

it("does not join or request photos when only memory metadata is needed", async () => {
  respond([memory]);
  expect((await listMemories({ photos: "none" })).memories[0].photos).toEqual([]);
  expect(requestedUrl().searchParams.get("select")).toBe("*");
  expect(request).toHaveBeenCalledTimes(1);
});

it("keeps empty photo collections and no memories to one request each", async () => {
  respond([{ ...memory, memory_photos: [] }]);
  expect((await listMemories()).memories[0].photos).toEqual([]);
  respond([]);
  expect(await listMemories()).toEqual({ persist: true, memories: [] });
  expect(request).toHaveBeenCalledTimes(2);
});

it("falls back for a stale relationship cache without losing covers", async () => {
  respond({ code: "PGRST200", message: "Relationship missing" }, 400);
  respond([memory]);
  respond([{ ...photo, id: "second", sort_order: 1 }, photo]);
  expect((await listMemories({ photos: "cover" })).memories[0].photos.map(item => item.id)).toEqual(["cover"]);
  expect(request).toHaveBeenCalledTimes(3);
  expect(requestedUrl(2).pathname).toBe("/rest/v1/memory_photos");
  expect(requestedUrl(2).searchParams.get("memory_id")).toBe('in.(memory)');
});

it("does not turn an ordinary provider outage into fallback requests or empty memories", async () => {
  respond({ code: "503", message: "Unavailable" }, 503);
  await expect(listMemories()).rejects.toThrow("추억을 불러오지 못했어요");
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["all", "cover"] as const)("supplies an initial private %s URL without re-reading auth or photo ownership", async photos => {
  const storagePath = "ours/cover.jpg";
  respond([{ ...memory, memory_photos: [{ ...photo, storage_url: "", storage_path: storagePath }] }]);
  respond([signature(storagePath)]);
  const result = await listMemories({ photos });
  const url = result.memories[0].photos[0].storageUrl;
  expect(url).toContain(`/storage/v1/object/sign/memory-photos/${storagePath}?token=`);
  expect(result.memories[0].coverUrl).toBe(url);
  const payload = JSON.parse(Buffer.from(new URL(url).searchParams.get("token")!.split(".")[1], "base64url").toString());
  expect(payload.exp * 1000 - Date.now()).toBeGreaterThan(59 * 60_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(requestedUrl(1).pathname).toBe("/storage/v1/object/sign/memory-photos");
  expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ expiresIn: 3600, paths: [storagePath] });
  expect(mocks.session).toHaveBeenCalledTimes(1);
});

it("bounds initial signing to 48 private paths, prioritizes covers, and retains unsigned album extras", async () => {
  const album = Array.from({ length: 60 }, (_, index) => ({ ...photo, id: `photo-${index}`, sort_order: index,
    storage_url: "", storage_path: `ours/photo-${index}.jpg` }));
  const other = { ...photo, id: "other-cover", memory_id: "other", storage_url: "", storage_path: "ours/other-cover.jpg" };
  respond([{ ...memory, memory_photos: album }, { ...memory, id: "other", memory_photos: [other] }]);
  request.mockImplementationOnce(async (_input, init) => Response.json(JSON.parse(String(init?.body)).paths.map(signature)));
  const result = await listMemories();
  const signedPaths: string[] = JSON.parse(String(request.mock.calls[1][1]?.body)).paths;
  expect(signedPaths).toHaveLength(48);
  expect(signedPaths[0]).toBe(album[0].storage_path);
  expect(signedPaths[1]).toBe(other.storage_path);
  expect(result.memories[0].photos).toHaveLength(60);
  expect(result.memories[0].photos.filter(item => item.storageUrl)).toHaveLength(47);
  expect(result.memories[0].photos[59]).toMatchObject({ storageUrl: "", storagePath: album[59].storage_path });
  expect(result.memories[1].coverUrl).toContain("other-cover.jpg");
  expect(request).toHaveBeenCalledTimes(2);
});

it("never signs paths outside the authenticated couple or photos attached to unreturned memories", async () => {
  respond([{ ...memory, memory_photos: [
    { ...photo, storage_url: "", storage_path: "other-couple/private.jpg" },
    { ...photo, id: "traversal", storage_url: "", storage_path: "ours/../other-couple/private.jpg" },
    { ...photo, id: "wrong-memory", memory_id: "unreturned", storage_url: "", storage_path: "ours/unreturned.jpg" },
  ] }]);
  expect((await listMemories()).memories[0].photos).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(1);
});

it("preserves memory text and retryable photo paths when initial Storage signing fails", async () => {
  respond([{ ...memory, memory_photos: [{ ...photo, storage_url: "", storage_path: "ours/cover.jpg" }] }]);
  respond({ statusCode: "503", error: "Unavailable", message: "Unavailable" }, 503);
  const result = await listMemories();
  expect(result.memories[0]).toMatchObject({ title: memory.title, coverUrl: "", photos: [{ storageUrl: "", storagePath: "ours/cover.jpg" }] });
  expect(request).toHaveBeenCalledTimes(2);
});

it("releases memory text after the initial signing budget when Storage stalls", async () => {
  vi.useFakeTimers();
  respond([{ ...memory, memory_photos: [{ ...photo, storage_url: "", storage_path: "ours/cover.jpg" }] }]);
  request.mockImplementationOnce(() => new Promise(() => {}));
  const reading = listMemories();
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await reading).memories[0]).toMatchObject({ title: memory.title, photos: [{ storageUrl: "", storagePath: "ours/cover.jpg" }] });
  expect(request).toHaveBeenCalledTimes(2);
});
