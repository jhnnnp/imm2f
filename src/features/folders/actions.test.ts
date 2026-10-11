import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderScope } from "./types";

const mocks = vi.hoisted(() => ({ session: vi.fn(), client: vi.fn(), revalidate: vi.fn(), activity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.activity }));

import { createFolder, deleteFolder, listFolderWorkspace, moveFolderItems, renameFolder } from "./actions";

const folderId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const otherItemId = "33333333-3333-4333-8333-333333333333";
const coupleId = "44444444-4444-4444-8444-444444444444";
const version = "2026-10-11T10:00:00.000Z";
const laterVersion = "2026-10-11T11:00:00.000Z";
const input = { name: "우리의 가을 여행", color: "sage" as const, attemptId: folderId };
const row = { id: folderId, couple_id: coupleId, scope: "vault", name: input.name, color: input.color, created_at: version, updated_at: version };
type Result = { data: unknown; error: unknown };

function query(data: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result> = {} as never;
  for (const method of ["select", "eq", "order", "range", "insert", "update", "delete", "single", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return chain;
}

function client(queues: Record<string, ReturnType<typeof query>[]> = {}, rpcResult: Result = { data: 1, error: null }) {
  const from = vi.fn((table: string) => {
    const next = queues[table]?.shift();
    if (!next) throw new Error(`Unexpected table read: ${table}`);
    return next;
  });
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const db = { from, rpc };
  mocks.client.mockResolvedValue(db);
  return db;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated", userId: "viewer", coupleId });
  mocks.activity.mockResolvedValue({ ok: true });
});

describe("folder authorization and runtime validation", () => {
  it.each(["gift", "", null, {}, ["vault"]])("rejects an invalid read scope before private access: %j", async scope => {
    await expect(listFolderWorkspace(scope as FolderScope)).rejects.toThrow("폴더 영역");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, [], "folder", { ...input, name: "" }, { ...input, name: "  " },
    { ...input, name: "a".repeat(41) }, { ...input, name: "a\nb" }, { ...input, name: "a\u0000b" },
    { ...input, name: 1 }, { ...input, color: "red" }, { ...input, color: null },
    { ...input, attemptId: "bad-id" }, { ...input, attemptId: null },
  ])("rejects invalid folder creation input before authentication or writes: %j", async value => {
    expect(await createFolder("vault", value as typeof input)).toHaveProperty("error");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("checks scope on every mutation before accessing a backend", async () => {
    const invalid = "gift" as FolderScope;
    expect(await createFolder(invalid, input)).toHaveProperty("error");
    expect(await renameFolder(invalid, folderId, input, version)).toHaveProperty("error");
    expect(await deleteFolder(invalid, folderId, version)).toHaveProperty("error");
    expect(await moveFolderItems(invalid, [itemId], folderId)).toHaveProperty("error");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["", "invalid", null, {}, "a".repeat(65)])("rejects malformed versions on rename and delete: %j", async guard => {
    expect(await renameFolder("vault", folderId, input, guard as string)).toHaveProperty("error");
    expect(await deleteFolder("vault", folderId, guard as string)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["", "bad-id", null, {}, `${folderId} `])("rejects malformed folder identifiers before mutation: %j", async id => {
    expect(await renameFolder("vault", id as string, input, version)).toHaveProperty("error");
    expect(await deleteFolder("vault", id as string, version)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([null, [], "ids", [null], ["not-a-uuid"], Array(501).fill(itemId)])("validates all bulk item identifiers and bounds before opening a client: %j", async ids => {
    expect(await moveFolderItems("vault", ids as string[], folderId)).toHaveProperty("error");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["bad-id", undefined, {}, `${folderId} `])("rejects a malformed bulk target instead of treating it as unfiled: %j", async id => {
    expect(await moveFolderItems("vault", [itemId], id as string)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["guest", "setup_error"])("returns no private records and blocks writes in %s mode", async mode => {
    mocks.session.mockResolvedValue({ mode });
    expect(await listFolderWorkspace("vault")).toEqual({ folders: [], memberships: [], persist: false });
    expect(await createFolder("vault", input)).toHaveProperty("error");
    expect(await renameFolder("vault", folderId, input, version)).toHaveProperty("error");
    expect(await deleteFolder("vault", folderId, version)).toHaveProperty("error");
    expect(await moveFolderItems("vault", [itemId], folderId)).toHaveProperty("error");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("returns a controlled unavailable state when the server client cannot be created", async () => {
    mocks.client.mockResolvedValue(null);
    expect(await listFolderWorkspace("places")).toEqual({ folders: [], memberships: [], persist: false });
    expect(await createFolder("places", input)).toHaveProperty("error");
    expect(await renameFolder("places", folderId, input)).toHaveProperty("error");
    expect(await deleteFolder("places", folderId)).toHaveProperty("error");
    expect(await moveFolderItems("places", [itemId], null)).toHaveProperty("error");
  });
});

describe("scoped folder workspace reads", () => {
  it.each(["vault", "places"] as const)("filters both tables by authenticated couple and %s scope", async scope => {
    const folders = query([{ ...row, scope }]);
    const memberships = query([{ id: "membership", item_id: itemId, folder_id: folderId }]);
    const db = client({ couple_folders: [folders], couple_folder_items: [memberships] });
    expect(await listFolderWorkspace(scope)).toEqual({
      folders: [{ id: folderId, name: row.name, color: "sage", createdAt: version, updatedAt: version }],
      memberships: [{ itemId, folderId }], persist: true,
    });
    expect(db.from.mock.calls.map(call => call[0])).toEqual(["couple_folders", "couple_folder_items"]);
    for (const read of [folders, memberships]) {
      expect(read.eq).toHaveBeenCalledWith("couple_id", coupleId);
      expect(read.eq).toHaveBeenCalledWith("scope", scope);
      expect(read.order).toHaveBeenCalledWith("id");
      expect(read.range).toHaveBeenCalledWith(0, 999);
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("paginates both collections independently beyond 1,000 rows and retains deterministic folder order", async () => {
    const folderPage = Array.from({ length: 1000 }, (_, index) => ({ ...row, id: `folder-${String(index).padStart(4, "0")}`, name: `folder ${index}` }));
    const memberPage = Array.from({ length: 1000 }, (_, index) => ({ id: `membership-${index}`, item_id: `item-${index}`, folder_id: folderId }));
    const folderFirst = query(folderPage);
    const folderSecond = query([{ ...row, id: "oldest", created_at: "2026-01-01T00:00:00.000Z" }]);
    const memberFirst = query(memberPage);
    const memberSecond = query([{ id: "tail", item_id: otherItemId, folder_id: folderId }]);
    client({ couple_folders: [folderFirst, folderSecond], couple_folder_items: [memberFirst, memberSecond] });
    const result = await listFolderWorkspace("vault");
    expect(result.folders).toHaveLength(1001);
    expect(result.memberships).toHaveLength(1001);
    expect(result.folders[0].id).toBe("oldest");
    expect(result.folders.at(-1)?.id).toBe("folder-0999");
    expect(result.memberships.at(-1)).toEqual({ itemId: otherItemId, folderId });
    for (const next of [folderSecond, memberSecond]) {
      expect(next.range).toHaveBeenCalledWith(1000, 1999);
      expect(next.eq).toHaveBeenCalledWith("couple_id", coupleId);
      expect(next.eq).toHaveBeenCalledWith("scope", "vault");
    }
  });

  it("checks the next page when an exact 1,000-row page is full", async () => {
    const first = query(Array.from({ length: 1000 }, (_, index) => ({ ...row, id: `folder-${index}` })));
    const last = query([]);
    const db = client({ couple_folders: [first, last], couple_folder_items: [query([])] });
    expect((await listFolderWorkspace("places")).folders).toHaveLength(1000);
    expect(last.range).toHaveBeenCalledWith(1000, 1999);
    expect(db.from).toHaveBeenCalledTimes(3);
  });

  it.each(["couple_folders", "couple_folder_items"])("rejects a failed %s read instead of presenting it as an empty workspace", async table => {
    client({ couple_folders: [query([], table === "couple_folders" ? { message: "internal schema" } : null)],
      couple_folder_items: [query([], table === "couple_folder_items" ? { message: "internal schema" } : null)] });
    await expect(listFolderWorkspace("vault")).rejects.toThrow("불러오지 못했어요");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("does not silently return an incomplete collection when a later page fails", async () => {
    client({ couple_folders: [query(Array.from({ length: 1000 }, (_, index) => ({ ...row, id: `folder-${index}` }))), query(null, { message: "offline" })],
      couple_folder_items: [query([])] });
    await expect(listFolderWorkspace("vault")).rejects.toThrow("폴더를 불러오지 못했어요");
  });
});

describe("retryable shared folder creation", () => {
  it.each(["vault", "places"] as const)("creates a trimmed %s folder using a stable identity and refreshes only its route", async scope => {
    const insert = query({ ...row, scope });
    client({ couple_folders: [insert] });
    const result = await createFolder(scope, { ...input, name: ` ${input.name} ` });
    expect(result).toMatchObject({ folder: { id: folderId, name: row.name } });
    expect(insert.insert).toHaveBeenCalledWith({ id: folderId, couple_id: coupleId, scope, name: input.name, color: "sage" });
    expect(mocks.revalidate.mock.calls).toEqual([[scope === "vault" ? "/vault" : "/places"]]);
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ coupleId, actorUserId: "viewer", entityType: "folder", action: scope === "places" ? "PLACE_FOLDERS_UPDATED" : "VAULT_UPDATED" }));
  });

  it.each([{ code: "23505", message: "duplicate identity" }, { message: "lost response" }, null])("adopts only the scoped canonical record after a failed or absent response: %j", async error => {
    const insert = query(null, error);
    const existing = query({ ...row, name: "파트너가 붙인 새 이름", color: "rose", updated_at: laterVersion });
    client({ couple_folders: [insert, existing] });
    expect(await createFolder("vault", input)).toMatchObject({ folder: { name: "파트너가 붙인 새 이름", color: "rose", updatedAt: laterVersion } });
    expect(existing.eq).toHaveBeenCalledWith("id", folderId);
    expect(existing.eq).toHaveBeenCalledWith("couple_id", coupleId);
    expect(existing.eq).toHaveBeenCalledWith("scope", "vault");
    expect(insert.update).not.toHaveBeenCalled();
    expect(existing.update).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/vault");
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("rejects a duplicate name when the request identity has no visible record", async () => {
    client({ couple_folders: [query(null, { code: "23505", message: "couple_folders_name_idx" }), query(null)] });
    const result = await createFolder("vault", input);
    expect(result).toMatchObject({ error: expect.stringContaining("같은 이름") });
    expect(JSON.stringify(result)).not.toContain("couple_folders_name_idx");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("does not convert an unsuccessful retry read into a successful create", async () => {
    client({ couple_folders: [query(null, { message: "transport" }), query(row, { message: "permission denied" })] });
    expect(await createFolder("vault", input)).toHaveProperty("error");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
});

describe("versioned folder management", () => {
  it("renames only the matching couple, scope, identity and previous version", async () => {
    const update = query({ ...row, name: "새 여행", color: "blue", updated_at: laterVersion });
    client({ couple_folders: [update] });
    expect(await renameFolder("vault", folderId, { name: " 새 여행 ", color: "blue" }, version)).toMatchObject({ folder: { name: "새 여행", color: "blue", updatedAt: laterVersion } });
    expect(update.update).toHaveBeenCalledWith({ name: "새 여행", color: "blue" });
    expect(update.eq.mock.calls).toEqual([["id", folderId], ["couple_id", coupleId], ["scope", "vault"], ["updated_at", version]]);
    expect(mocks.revalidate).toHaveBeenCalledWith("/vault");
  });

  it("returns a conflict for a stale rename and never reports a write success", async () => {
    const update = query(null);
    client({ couple_folders: [update] });
    expect(await renameFolder("places", folderId, input, version)).toMatchObject({ error: expect.stringContaining("파트너") });
    expect(update.eq).toHaveBeenCalledWith("updated_at", version);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([{ code: "23505", message: "private duplicate detail" }, { message: "private database detail" }])("maps rename errors to safe actionable text: %j", async error => {
    client({ couple_folders: [query(null, error)] });
    const result = await renameFolder("vault", folderId, input, version);
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("deletes only the guarded folder and leaves item deletion to no client operation", async () => {
    const remove = query({ id: folderId });
    const db = client({ couple_folders: [remove] });
    expect(await deleteFolder("places", folderId, version)).toEqual({ ok: true });
    expect(remove.eq.mock.calls).toEqual([["id", folderId], ["couple_id", coupleId], ["scope", "places"], ["updated_at", version]]);
    expect(db.from.mock.calls).toEqual([["couple_folders"]]);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/places");
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "PLACE_FOLDERS_UPDATED", detail: expect.stringContaining("미분류") }));
  });

  it.each([{ data: null, error: null }, { data: null, error: { message: "private schema detail" } }])("does not claim a stale or failed deletion succeeded: %j", async result => {
    client({ couple_folders: [query(result.data, result.error)] });
    const response = await deleteFolder("vault", folderId, version);
    expect(response).toHaveProperty("error");
    expect(JSON.stringify(response)).not.toContain("private");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("supports the optional legacy version guard without adding an undefined filter", async () => {
    const update = query(row);
    const remove = query({ id: folderId });
    client({ couple_folders: [update, remove] });
    expect(await renameFolder("vault", folderId, input)).toHaveProperty("folder");
    expect(await deleteFolder("vault", folderId)).toEqual({ ok: true });
    expect(update.eq.mock.calls.some(call => call[0] === "updated_at")).toBe(false);
    expect(remove.eq.mock.calls.some(call => call[0] === "updated_at")).toBe(false);
  });
});

describe("bulk folder RPC contract", () => {
  it.each(["vault", "places"] as const)("moves a deduplicated %s batch with one authenticated RPC and no per-item writes", async scope => {
    const db = client({}, { data: 2, error: null });
    expect(await moveFolderItems(scope, [itemId, otherItemId, itemId], folderId)).toEqual({ ok: true });
    expect(db.rpc.mock.calls).toEqual([["move_couple_folder_items", { p_scope: scope, p_item_ids: [itemId, otherItemId], p_folder_id: folderId }]]);
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith(scope === "vault" ? "/vault" : "/places");
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ coupleId, actorUserId: "viewer", action: scope === "places" ? "PLACE_FOLDERS_UPDATED" : "VAULT_UPDATED" }));
  });

  it("represents unfiling with an explicit null target", async () => {
    const db = client();
    expect(await moveFolderItems("vault", [itemId], null)).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("move_couple_folder_items", { p_scope: "vault", p_item_ids: [itemId], p_folder_id: null });
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "VAULT_UPDATED", detail: "1개 항목을 미분류로 옮겼어요" }));
  });

  it.each([
    { data: null, error: { message: "Item unavailable: private id" } },
    { data: 1, error: null }, { data: 0, error: null }, { data: null, error: null }, { data: "2", error: null },
  ])("returns a controlled failure if the complete batch is not acknowledged: %j", async result => {
    const db = client({}, result);
    const response = await moveFolderItems("places", [itemId, otherItemId], folderId);
    expect(response).toHaveProperty("error");
    expect(JSON.stringify(response)).not.toContain("private");
    // The action relies on the transactional RPC. It must not compensate with
    // individual writes or declare success when that RPC rejects the batch.
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("accepts the maximum 500-item batch as a single request", async () => {
    const ids = Array.from({ length: 500 }, (_, index) => `55555555-5555-4555-8555-${index.toString(16).padStart(12, "0")}`);
    const db = client({}, { data: 500, error: null });
    expect(await moveFolderItems("vault", ids, folderId)).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls[0][1].p_item_ids).toEqual(ids);
  });
});

describe("committed folder mutations and optional activity delivery", () => {
  it.each(["create", "rename", "delete", "move"] as const)("keeps a successful %s when activity delivery fails", async operation => {
    mocks.activity.mockRejectedValue(new Error("activity feed unavailable"));
    const write = query(operation === "delete" ? { id: folderId } : row);
    client(operation === "move" ? {} : { couple_folders: [write] });
    const result = operation === "create" ? await createFolder("vault", input)
      : operation === "rename" ? await renameFolder("vault", folderId, input, version)
        : operation === "delete" ? await deleteFolder("vault", folderId, version)
          : await moveFolderItems("vault", [itemId], null);
    expect(result).not.toHaveProperty("error");
    expect(mocks.activity).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).toHaveBeenCalledWith("/vault");
  });
});
