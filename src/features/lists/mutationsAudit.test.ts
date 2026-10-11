import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteKind } from "./types";
import type { NoteCreationInput } from "./noteCreationAttempt";

const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), activity: vi.fn(), refresh: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity }));
import { createNotesBatch, deleteNote, reorderNotes, updateNoteContent, updateNoteStatus } from "./actions";

const version = "2026-10-11T01:00:00.000Z";
const row = { id: "note-1", kind: "bucket", title: "함께 걷기", detail: "30분", extra: "가을", status: "wish", created_at: version, created_by: "you", updated_at: version };
type Result = { data: unknown; error: unknown };
function query(data: unknown = null, error: unknown = null, rejection?: Error) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result> = {} as never;
  for (const name of ["select", "eq", "in", "update", "delete", "order", "limit", "maybeSingle"]) chain[name] = vi.fn(() => chain);
  chain.then = (resolve, reject) => (rejection ? Promise.reject(rejection) : Promise.resolve({ data, error })).then(resolve, reject);
  return chain;
}
function client(...queries: ReturnType<typeof query>[]) {
  const from = vi.fn();
  for (const builder of queries) from.mockReturnValueOnce(builder);
  mocks.client.mockResolvedValue({ from });
  return from;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", userId: "you", coupleId: "couple" });
  mocks.activity.mockResolvedValue({ ok: true });
});

describe("shared note runtime input validation", () => {
  it.each([null, [], "title", { title: null }, { detail: 7 }, { extra: {} }, { title: "a".repeat(141) }, { detail: "a".repeat(4001) }, { extra: "a".repeat(4097) }])("rejects malformed or oversized edit patches before backend access: %j", async patch => {
    expect(await updateNoteContent("note-1", patch as { title?: string })).toHaveProperty("error");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, "", "a".repeat(129)])("rejects invalid deletion identifiers: %j", async id => {
    expect(await deleteNote(id as string)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([null, {}, "", "a".repeat(65)])("rejects malformed concurrency guards before updating content or status: %j", async guard => {
    expect(await updateNoteContent("note-1", { detail: "new" }, guard as string)).toHaveProperty("error");
    expect(await updateNoteStatus("note-1", "done", guard as string)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([null, {}, "invalid", ""])("rejects invalid states before reading a private note: %j", async status => {
    expect(await updateNoteStatus("note-1", status as string)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([null, ["note-1", "note-1"], [""], [{}], Array(501).fill("note-1")])("rejects malformed full reorder requests before any write: %j", async ids => {
    expect(await reorderNotes("bucket", ids as string[])).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([
    { title: "a".repeat(141), detail: "", extra: "" },
    { title: "기차", detail: "a".repeat(4001), extra: "" },
    { title: "기차", detail: "", extra: "a".repeat(4097) },
    { title: "기차", detail: "", extra: "", status: "done" },
  ])("checks every creation field and the kind's allowed status before mutation", async item => {
    expect(await createNotesBatch("vault", [item as NoteCreationInput])).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects a forged kind without property-key coercion errors", async () => {
    expect(await createNotesBatch(Object.create(null) as NoteKind, [])).toHaveProperty("error");
    expect(await reorderNotes(Object.create(null) as NoteKind, [])).toHaveProperty("error");
  });
});

describe("committed shared note mutations", () => {
  it("returns the edited canonical row and refreshes the page when the feed is unavailable", async () => {
    const write = query({ ...row, detail: "new", updated_at: "2026-10-11T02:00:00.000Z" });
    client(write);
    mocks.activity.mockRejectedValue(new Error("feed offline"));
    expect(await updateNoteContent("note-1", { detail: " new " }, version)).toMatchObject({ note: { detail: "new", updatedAt: "2026-10-11T02:00:00.000Z" } });
    expect(write.update).toHaveBeenCalledWith({ detail: "new" });
    expect(write.eq).toHaveBeenCalledWith("couple_id", "couple");
    expect(write.eq).toHaveBeenCalledWith("updated_at", version);
    expect(mocks.refresh).toHaveBeenCalledWith("/bucket");
  });
  it("preserves successful status updates when the optional feed rejects", async () => {
    const write = query({ ...row, status: "done" });
    client(query({ kind: "bucket" }), write);
    mocks.activity.mockRejectedValue(new Error("feed offline"));
    expect(await updateNoteStatus("note-1", "done", version)).toMatchObject({ ok: true, note: { status: "done" } });
    expect(write.eq).toHaveBeenCalledWith("updated_at", version);
    expect(mocks.refresh).toHaveBeenCalledWith("/bucket");
  });
  it("removes an already deleted note from the client even if its activity cannot be recorded", async () => {
    const remove = query({ kind: "gift" });
    client(remove);
    mocks.activity.mockRejectedValue(new Error("feed offline"));
    expect(await deleteNote("note-1")).toEqual({ ok: true });
    expect(remove.eq).toHaveBeenCalledWith("couple_id", "couple");
    expect(mocks.refresh).toHaveBeenCalledWith("/gifts");
  });
  it("keeps a complete reorder successful when activity recording fails", async () => {
    const first = query({ id: "first" });
    const second = query({ id: "second" });
    client(query([{ id: "first" }, { id: "second" }]), first, second);
    mocks.activity.mockRejectedValue(new Error("feed offline"));
    expect(await reorderNotes("bucket", ["first", "second"])).toEqual({ ok: true });
    expect(first.update).toHaveBeenCalledWith({ sort_order: 0 });
    expect(second.update).toHaveBeenCalledWith({ sort_order: 1 });
    expect(mocks.refresh).toHaveBeenCalledWith("/bucket");
  });
  it("announces partial reorder writes and returns a controlled error after a transport rejection", async () => {
    const first = query({ id: "first" });
    const second = query(null, null, new Error("transport offline"));
    client(query([{ id: "first" }, { id: "second" }]), first, second);
    const result = await reorderNotes("bucket", ["first", "second"]);
    expect(result).toMatchObject({ error: expect.stringContaining("일부 순서") });
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "BUCKET_UPDATED" }));
    expect(mocks.refresh).toHaveBeenCalledWith("/bucket");
  });
  it("does not announce a reorder where every row failed", async () => {
    client(query([{ id: "first" }, { id: "second" }]), query(null, null, new Error("offline")), query(null, { message: "offline" }));
    expect(await reorderNotes("bucket", ["first", "second"])).toHaveProperty("error");
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("does not announce or accept a stale content version", async () => {
    const write = query(null);
    client(write);
    expect(await updateNoteContent("note-1", { detail: "stale" }, version)).toMatchObject({ error: expect.stringContaining("파트너") });
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("uses a controlled save error without exposing raw database text", async () => {
    client(query(null, { message: "internal schema detail" }));
    const result = await updateNoteContent("note-1", { detail: "new" }, version);
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain("internal schema");
  });
});
