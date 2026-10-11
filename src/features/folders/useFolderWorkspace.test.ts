// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/features/auth/types";
import type { SharedRefreshContext, SharedRefreshOptions } from "@/features/collaboration/useSharedRefresh";
import type { ArchiveFolder, FolderScope, FolderWorkspace } from "./types";

const mocks = vi.hoisted(() => ({
  session: { mode: "authenticated", userId: "user-a", coupleId: "couple-a", displayName: "진한", partner: null } as AppSession,
  read: vi.fn(), move: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), emit: vi.fn(), retry: vi.fn(),
  refresh: null as null | ((context: SharedRefreshContext) => Promise<void>),
  options: {} as SharedRefreshOptions,
}));
vi.mock("@/features/auth/components/SessionProvider", () => ({ useAppSession: () => mocks.session }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({
  useSharedRefresh: (refresh: (context: SharedRefreshContext) => Promise<void>, options: SharedRefreshOptions) => {
    mocks.refresh = refresh; mocks.options = options; return mocks.retry;
  },
}));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: mocks.emit }));
vi.mock("./actions", () => ({
  listFolderWorkspace: mocks.read, moveFolderItems: mocks.move, createFolder: mocks.create,
  renameFolder: mocks.rename, deleteFolder: mocks.remove,
}));
import { useFolderWorkspace } from "./useFolderWorkspace";

const folderA: ArchiveFolder = { id: "folder-a", name: "둘의 주말", color: "sage", createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" };
const folderB: ArchiveFolder = { ...folderA, id: "folder-b", name: "바다 보러 가기", color: "blue" };
const initial: FolderWorkspace = { persist: true, folders: [folderA, folderB], memberships: [{ itemId: "item-a", folderId: folderA.id }, { itemId: "item-b", folderId: folderB.id }] };
const empty: FolderWorkspace = { persist: false, folders: [], memberships: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session = { mode: "authenticated", userId: "user-a", coupleId: "couple-a", displayName: "진한", partner: null };
  mocks.refresh = null;
  mocks.options = {};
  mocks.read.mockResolvedValue(empty);
  mocks.move.mockResolvedValue({ ok: true });
  mocks.remove.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("useFolderWorkspace session and scope isolation", () => {
  it("starts at a folder-only root and exposes all items only after an explicit selection", () => {
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    expect(result.current.selectedFolderId).toBe("root");
    expect(result.current.matchesFolder("item-a")).toBe(false);
    expect(result.current.matchesFolder("item-c")).toBe(false);
    act(() => result.current.setSelectedFolderId("all"));
    expect(result.current.matchesFolder("item-a")).toBe(true);
    expect(result.current.matchesFolder("item-c")).toBe(true);
    act(() => result.current.setSelectedFolderId("root"));
    expect(result.current.matchesFolder("item-a")).toBe(false);
    expect(result.current.workspace).toBe(initial);
  });
  it("uses initial server data without an unnecessary initial read and subscribes to scoped folder changes", () => {
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    expect(result.current.workspace).toBe(initial);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.options.tables).toEqual(["couple_folders", "couple_folder_items"]);
    expect(mocks.options.activityPrefixes).toEqual(["PLACE_", "PARTNER_"]);
  });
  it.each([
    { mode: "authenticated", userId: "user-a", coupleId: "couple-b", displayName: "진한", partner: null },
    { mode: "authenticated", userId: "user-b", coupleId: "couple-a", displayName: "현정", partner: null },
    { mode: "guest" },
  ] satisfies AppSession[])("clears old server props and selection when the session becomes %j", async session => {
    const next = deferred<FolderWorkspace>();
    mocks.read.mockReturnValue(next.promise);
    const { result, rerender } = renderHook(() => useFolderWorkspace("places", initial));
    act(() => result.current.setSelectedFolderId(folderA.id));
    mocks.session = session;
    rerender();
    expect(result.current.workspace).toEqual(empty);
    expect(result.current.selectedFolderId).toBe("root");
    expect(result.current.folderFor("item-a")).toBeNull();
    expect(mocks.read).toHaveBeenCalledWith("places");
    const current: FolderWorkspace = { persist: session.mode === "authenticated", folders: [], memberships: [] };
    await act(async () => { next.resolve(current); });
    expect(result.current.workspace).toEqual(current);
    expect(result.current.workspace.folders).not.toContain(folderA);
  });
  it("clears vault data when the same mounted hook changes to places", async () => {
    const next = deferred<FolderWorkspace>();
    mocks.read.mockReturnValue(next.promise);
    const { result, rerender } = renderHook(({ scope }: { scope: FolderScope }) => useFolderWorkspace(scope, initial), { initialProps: { scope: "vault" } });
    rerender({ scope: "places" });
    expect(result.current.workspace).toEqual(empty);
    expect(mocks.read).toHaveBeenCalledWith("places");
    await act(async () => { next.resolve(empty); });
  });
  it("rejects a slow response from the previous couple after the next couple has loaded", async () => {
    const previous = deferred<FolderWorkspace>();
    const current: FolderWorkspace = { persist: true, folders: [{ ...folderB, id: "new-couple-folder", name: "새 공간" }], memberships: [] };
    mocks.read.mockReturnValueOnce(previous.promise).mockResolvedValueOnce(current);
    const { result, rerender } = renderHook(() => useFolderWorkspace("places", initial));
    let staleRead!: Promise<void>;
    act(() => { staleRead = mocks.refresh!({ isCurrent: () => true }); });
    mocks.session = { ...mocks.session, coupleId: "couple-b" } as AppSession;
    await act(async () => { rerender(); });
    expect(result.current.workspace).toEqual(current);
    await act(async () => { previous.resolve(initial); await staleRead; });
    expect(result.current.workspace).toEqual(current);
  });
  it("does not expose folder mutations or issue reads when no folder scope is active", async () => {
    const { result } = renderHook(() => useFolderWorkspace(null));
    let success = true;
    await act(async () => { success = await result.current.moveItems(["item-a"], folderA.id); result.current.reload(); });
    expect(success).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.options.tables).toEqual([]);
  });
  it("does not apply an old mutation when the hook returns to the same session after A → B → A", async () => {
    const oldMove = deferred<{ ok: true }>();
    mocks.move.mockReturnValueOnce(oldMove.promise);
    mocks.read.mockResolvedValueOnce(empty).mockResolvedValueOnce(initial);
    const sessionA = mocks.session;
    const { result, rerender } = renderHook(() => useFolderWorkspace("places", initial));
    let staleMove!: Promise<boolean>;
    act(() => { staleMove = result.current.moveItems(["item-a"], folderB.id); });
    mocks.session = { ...sessionA, coupleId: "couple-b" } as AppSession;
    await act(async () => { rerender(); });
    mocks.session = sessionA;
    await act(async () => { rerender(); });
    expect(result.current.folderFor("item-a")).toBe(folderA.id);
    let staleSucceeded = true;
    await act(async () => { oldMove.resolve({ ok: true }); staleSucceeded = await staleMove; });
    expect(staleSucceeded).toBe(false);
    expect(result.current.folderFor("item-a")).toBe(folderA.id);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it.each(["success", "failure", "transport"])("an old %s response cannot clear a newer pending move after A → B → A", async response => {
    const oldMove = deferred<{ ok: true } | { error: string }>();
    const newMove = deferred<{ ok: true }>();
    mocks.move.mockReturnValueOnce(oldMove.promise).mockReturnValueOnce(newMove.promise);
    mocks.read.mockResolvedValueOnce(empty).mockResolvedValueOnce(initial);
    const sessionA = mocks.session;
    const { result, rerender } = renderHook(() => useFolderWorkspace("places", initial));
    let staleMove!: Promise<boolean>;
    act(() => { staleMove = result.current.moveItems(["item-a"], folderB.id); });
    mocks.session = { ...sessionA, coupleId: "couple-b" } as AppSession;
    await act(async () => { rerender(); });
    mocks.session = sessionA;
    await act(async () => { rerender(); });
    let currentMove!: Promise<boolean>;
    act(() => { currentMove = result.current.moveItems(["item-a"], folderB.id); });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      if (response === "transport") oldMove.reject(new Error("old connection"));
      else oldMove.resolve(response === "success" ? { ok: true } : { error: "오래된 실패" });
      expect(await staleMove).toBe(false);
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.error).toBe("");
    expect(result.current.folderFor("item-a")).toBe(folderA.id);
    await act(async () => { expect(await result.current.moveItems(["item-a"], folderB.id)).toBe(false); });
    expect(mocks.move).toHaveBeenCalledTimes(2);
    await act(async () => { newMove.resolve({ ok: true }); expect(await currentMove).toBe(true); });
    expect(result.current.pending).toBe(false);
    expect(result.current.folderFor("item-a")).toBe(folderB.id);
    expect(mocks.emit).toHaveBeenCalledOnce();
  });
});

describe("useFolderWorkspace moves and synchronized refresh", () => {
  it("applies one successful multi-item move and preserves unrelated memberships", async () => {
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    let success = false;
    await act(async () => { success = await result.current.moveItems(["item-a", "item-c"], folderB.id); });
    expect(success).toBe(true);
    expect(mocks.move).toHaveBeenCalledWith("places", ["item-a", "item-c"], folderB.id);
    expect(result.current.folderFor("item-a")).toBe(folderB.id);
    expect(result.current.folderFor("item-b")).toBe(folderB.id);
    expect(result.current.folderFor("item-c")).toBe(folderB.id);
    expect(mocks.emit).toHaveBeenCalledOnce();
    expect(mocks.retry).toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
  it("moves items to unfiled while keeping the folders and other items", async () => {
    const { result } = renderHook(() => useFolderWorkspace("vault", initial));
    await act(async () => { await result.current.moveItems(["item-a"], null); result.current.setSelectedFolderId("unfiled"); });
    expect(result.current.workspace.folders).toEqual(initial.folders);
    expect(result.current.matchesFolder("item-a")).toBe(true);
    expect(result.current.matchesFolder("item-b")).toBe(false);
    expect(result.current.folderFor("item-b")).toBe(folderB.id);
  });
  it("rejects a slow pre-move read so it cannot restore the previous assignment", async () => {
    const old = deferred<FolderWorkspace>();
    mocks.read.mockReturnValue(old.promise);
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    let oldRead!: Promise<void>;
    act(() => { oldRead = mocks.refresh!({ isCurrent: () => true }); });
    await act(async () => { await result.current.moveItems(["item-a"], folderB.id); });
    expect(result.current.folderFor("item-a")).toBe(folderB.id);
    await act(async () => { old.resolve(initial); await oldRead; });
    expect(result.current.folderFor("item-a")).toBe(folderB.id);
  });
  it("prevents duplicate submissions and reads while a move is pending", async () => {
    const moving = deferred<{ ok: true }>();
    mocks.move.mockReturnValue(moving.promise);
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    let first!: Promise<boolean>;
    act(() => { first = result.current.moveItems(["item-a"], folderB.id); });
    expect(result.current.pending).toBe(true);
    let duplicate = true;
    await act(async () => {
      duplicate = await result.current.moveItems(["item-a"], folderB.id);
      await mocks.refresh!({ isCurrent: () => true });
    });
    expect(duplicate).toBe(false);
    expect(mocks.move).toHaveBeenCalledOnce();
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => { moving.resolve({ ok: true }); await first; });
    expect(result.current.pending).toBe(false);
  });
  it("keeps assignments and the actionable error after a failed move, including a later successful refresh", async () => {
    const message = "폴더나 항목이 변경됐어요. 최신 내용을 확인한 뒤 다시 이동해 주세요.";
    mocks.move.mockResolvedValue({ error: message });
    mocks.read.mockResolvedValue(initial);
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    let success = true;
    await act(async () => { success = await result.current.moveItems(["item-a"], folderB.id); });
    expect(success).toBe(false);
    expect(result.current.folderFor("item-a")).toBe(folderA.id);
    expect(result.current.error).toBe(message);
    expect(mocks.emit).not.toHaveBeenCalled();
    await act(async () => { await mocks.refresh!({ isCurrent: () => true }); });
    expect(result.current.error).toBe(message);
  });
  it("preserves assignments and permits retry after a thrown transport error", async () => {
    mocks.move.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    await act(async () => { await result.current.moveItems(["item-a"], folderB.id); });
    expect(result.current.folderFor("item-a")).toBe(folderA.id);
    expect(result.current.error).toContain("연결을 확인");
    expect(result.current.pending).toBe(false);
    await act(async () => { await result.current.moveItems(["item-a"], folderB.id); });
    expect(result.current.folderFor("item-a")).toBe(folderB.id);
    expect(result.current.error).toBe("");
  });
  it("discards a pending old-session move result without exposing its folders in the next session", async () => {
    const moving = deferred<{ ok: true }>();
    mocks.move.mockReturnValue(moving.promise);
    const { result, rerender } = renderHook(() => useFolderWorkspace("places", initial));
    let previousMove!: Promise<boolean>;
    act(() => { previousMove = result.current.moveItems(["item-a"], folderB.id); });
    mocks.session = { ...mocks.session, coupleId: "couple-b" } as AppSession;
    await act(async () => { rerender(); });
    let previousSucceeded = true;
    await act(async () => { moving.resolve({ ok: true }); previousSucceeded = await previousMove; });
    expect(previousSucceeded).toBe(false);
    expect(result.current.workspace).toEqual(empty);
    expect(result.current.pending).toBe(false);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("does not apply a read when the shared refresh guard has been invalidated", async () => {
    mocks.read.mockResolvedValue(empty);
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    await act(async () => { await mocks.refresh!({ isCurrent: () => false }); });
    expect(result.current.workspace).toBe(initial);
  });
});

describe("useFolderWorkspace folder removal", () => {
  it("clears a temporary read error after a successful retry without losing valid state", async () => {
    mocks.read.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(initial);
    const { result } = renderHook(() => useFolderWorkspace("places", initial));
    await act(async () => { await mocks.refresh!({ isCurrent: () => true }); });
    expect(result.current.workspace).toBe(initial);
    expect(result.current.error).toContain("불러오지 못했어요");
    await act(async () => { await mocks.refresh!({ isCurrent: () => true }); });
    expect(result.current.error).toBe("");
    expect(result.current.workspace).toBe(initial);
  });
  it("treats an orphaned membership from an interleaved folder read as unfiled", () => {
    const orphaned: FolderWorkspace = { ...initial, folders: [folderB] };
    const { result } = renderHook(() => useFolderWorkspace("vault", orphaned));
    act(() => result.current.setSelectedFolderId("unfiled"));
    expect(result.current.folderFor("item-a")).toBeNull();
    expect(result.current.matchesFolder("item-a")).toBe(true);
    expect(result.current.folderFor("item-b")).toBe(folderB.id);
    expect(result.current.matchesFolder("item-b")).toBe(false);
  });
  it("removes only the folder assignment so all records remain available in unfiled", async () => {
    const { result } = renderHook(() => useFolderWorkspace("vault", initial));
    act(() => result.current.setSelectedFolderId(folderA.id));
    await act(async () => { await result.current.remove(folderA); });
    expect(mocks.remove).toHaveBeenCalledWith("vault", folderA.id, folderA.updatedAt);
    expect(result.current.workspace.folders).toEqual([folderB]);
    expect(result.current.workspace.memberships).toEqual([{ itemId: "item-b", folderId: folderB.id }]);
    expect(result.current.selectedFolderId).toBe("root");
    act(() => result.current.setSelectedFolderId("unfiled"));
    expect(result.current.matchesFolder("item-a")).toBe(true);
    expect(result.current.matchesFolder("item-b")).toBe(false);
  });
  it("keeps a partner-modified folder and its items when deletion fails", async () => {
    mocks.remove.mockResolvedValue({ error: "폴더가 변경되거나 삭제됐어요. 최신 내용을 확인해 주세요." });
    const { result } = renderHook(() => useFolderWorkspace("vault", initial));
    await act(async () => { await result.current.remove(folderA); });
    expect(result.current.workspace).toBe(initial);
    expect(result.current.error).toContain("최신 내용을 확인");
  });
});
