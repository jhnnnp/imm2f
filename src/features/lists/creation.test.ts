import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getAppSession: vi.fn(), activity: vi.fn(), revalidate: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.getAppSession }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity }));

import { createNote, createNotesBatch } from "./actions";
import { noteCreationAttempt } from "./noteCreationAttempt";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const input = { attemptId: id, title: "기차", detail: "출발 10시", extra: "예약번호", status: "kept" };
const row = { id, kind: "vault", title: "기차", detail: "출발 10시", extra: "예약번호", status: "kept", created_at: "2026-10-11", created_by: "user-1", updated_at: "now" };

function query(data: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<{ data: unknown; error: unknown }> = {} as never;
  for (const method of ["select", "eq", "in", "order", "limit", "maybeSingle", "insert", "upsert"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return chain;
}

function client(...queries: ReturnType<typeof query>[]) {
  const from = vi.fn();
  for (const q of queries) from.mockReturnValueOnce(q);
  const db = { from };
  mocks.createClient.mockResolvedValue(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppSession.mockResolvedValue({ mode: "authenticated", userId: "user-1", coupleId: "couple-1" });
  mocks.activity.mockResolvedValue({ ok: true });
});

describe("retryable shared note creation", () => {
  it("uses the stable identity without updating a conflicting record", async () => {
    const write = query([row]);
    client(query({ sort_order: -2 }), write);
    expect(await createNote("vault", input)).toHaveProperty("note.id", id);
    expect(write.upsert).toHaveBeenCalledWith([expect.objectContaining({ id, title: "기차", sort_order: -3 })], { onConflict: "id", ignoreDuplicates: true });
    expect(write.insert).not.toHaveBeenCalled();
    expect(mocks.activity).toHaveBeenCalledTimes(1);
  });

  it("returns the saved record after a lost response and retains partner edits", async () => {
    const read = query([{ ...row, detail: "파트너가 변경한 시간" }]);
    client(query({ sort_order: -3 }), query(null, { message: "fetch failed" }), read);
    expect(await createNote("vault", input)).toHaveProperty("note.detail", "파트너가 변경한 시간");
    expect(read.eq).toHaveBeenCalledWith("couple_id", "couple-1");
    expect(read.eq).toHaveBeenCalledWith("created_by", "user-1");
    expect(read.eq).toHaveBeenCalledWith("kind", "vault");
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("replays a scan batch in its original order without a second activity", async () => {
    client(query({ sort_order: -4 }), query([]), query([{ ...row, id: id2, title: "호텔" }, row]));
    const result = await createNotesBatch("vault", [input, { ...input, attemptId: id2, title: "호텔" }]);
    expect("notes" in result && result.notes.map(note => note.id)).toEqual([id, id2]);
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("does not adopt an identity belonging to another actor or workspace", async () => {
    client(query({ sort_order: 0 }), query([]), query([]));
    expect(await createNote("vault", input)).toHaveProperty("error");
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("keeps a successful save when notification recording fails", async () => {
    client(query(), query([row]));
    mocks.activity.mockRejectedValue(new Error("notification unavailable"));
    expect(await createNote("vault", input)).toHaveProperty("note.id", id);
  });

  it.each([
    [{ ...input, attemptId: "bad-id" }],
    [input, input],
    [input, { title: "호텔", detail: "", extra: "" }],
    [null],
    [{ title: null, detail: "", extra: "" }],
  ])("validates every item and identity before a write: %j", async (...items) => {
    const values = items.length === 1 && Array.isArray(items[0]) ? items[0] : items;
    expect(await createNotesBatch("vault", values as typeof input[])).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("blocks guests before opening a database client", async () => {
    mocks.getAppSession.mockResolvedValue({ mode: "guest" });
    expect(await createNote("vault", input)).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("draft retry identity", () => {
  it("retains one identity for unchanged trimmed contents and replaces it on a new draft", () => {
    const makeId = vi.fn().mockReturnValueOnce(id).mockReturnValueOnce(id2);
    const first = noteCreationAttempt(null, "vault", input, makeId);
    const replay = noteCreationAttempt(first, "vault", { ...input, title: " 기차 " }, makeId);
    expect(replay).toBe(first);
    expect(noteCreationAttempt(replay, "vault", { ...input, detail: "새 예약" }, makeId).id).toBe(id2);
    expect(makeId).toHaveBeenCalledTimes(2);
  });
});
