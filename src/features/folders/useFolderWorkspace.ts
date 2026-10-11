"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { createFolder, deleteFolder, listFolderWorkspace, moveFolderItems, renameFolder } from "./actions";
import { moveMemberships } from "./folderState";
import { EMPTY_FOLDER_WORKSPACE, type ArchiveFolder, type FolderScope, type FolderSelection, type FolderWorkspace } from "./types";

export function useFolderWorkspace(scope: FolderScope | null, initialFolderWorkspace?: FolderWorkspace) {
  const session = useAppSession();
  const key = `${scope ?? ""}:${session.mode === "authenticated" ? `${session.userId}:${session.coupleId}` : session.mode}`;
  const currentKey = useRef(key);
  const initializedKey = useRef(key);
  const sessionEpoch = useRef(0);
  if (currentKey.current !== key) sessionEpoch.current += 1;
  currentKey.current = key;
  const generation = useRef(0);
  const locked = useRef(false);
  const [state, setState] = useState(() => ({ key, workspace: initialFolderWorkspace ?? EMPTY_FOLDER_WORKSPACE }));
  const [selection, setSelection] = useState<{ key: string; id: FolderSelection }>({ key, id: "all" });
  const [failure, setFailure] = useState<{ key: string; message: string; source: "read" | "write" | "" }>({ key, message: "", source: "" });
  const [working, setWorking] = useState("");
  const workspace = state.key === key ? state.workspace : EMPTY_FOLDER_WORKSPACE;
  const selectedFolderId = selection.key === key ? selection.id : "all";
  const error = failure.key === key ? failure.message : "";
  const pending = working === key;
  const refresh = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!scope || locked.current) return;
    const stamp = ++generation.current;
    try {
      const next = await listFolderWorkspace(scope);
      if (currentKey.current !== key || stamp !== generation.current || !isCurrent()) return;
      setState({ key, workspace: next });
      setFailure(previous => previous.key === key && previous.source === "read" ? { key, message: "", source: "" } : previous);
    } catch {
      if (currentKey.current === key && stamp === generation.current && isCurrent()) setFailure({ key, message: "폴더를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.", source: "read" });
    }
  }, [key, scope]);
  const retry = useSharedRefresh(async ({ isCurrent }) => { await refresh(isCurrent); }, { tables: scope ? ["couple_folders", "couple_folder_items"] : [], activityPrefixes: scope ? [scope === "places" ? "PLACE_" : "VAULT_", "PARTNER_"] : [], pollIntervalMs: 30_000, refreshOnConnect: !!scope });
  useEffect(() => {
    generation.current += 1;
    locked.current = false;
    setState(previous => previous.key === key ? previous : { key, workspace: EMPTY_FOLDER_WORKSPACE });
    setFailure({ key, message: "", source: "" });
    setWorking("");
    if (scope && (!initialFolderWorkspace || initializedKey.current !== key)) void refresh();
    initializedKey.current = key;
    return () => { generation.current += 1; };
    // Initial server data belongs to this session/scope; later changes come from scoped refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope, refresh]);
  useEffect(() => {
    if (selectedFolderId !== "all" && selectedFolderId !== "unfiled" && !workspace.folders.some(folder => folder.id === selectedFolderId)) setSelection({ key, id: "all" });
  }, [key, selectedFolderId, workspace.folders]);
  const byItem = useMemo(() => {
    const folderIds = new Set(workspace.folders.map(folder => folder.id));
    return new Map(workspace.memberships.filter(entry => folderIds.has(entry.folderId)).map(entry => [entry.itemId, entry.folderId]));
  }, [workspace.memberships, workspace.folders]);
  const setSelectedFolderId = useCallback((id: FolderSelection) => { setSelection({ key, id }); }, [key]);
  const folderFor = useCallback((id: string) => byItem.get(id) ?? null, [byItem]);
  const matchesFolder = useCallback((id: string) => selectedFolderId === "all" || (selectedFolderId === "unfiled" ? !byItem.has(id) : byItem.get(id) === selectedFolderId), [byItem, selectedFolderId]);

  async function mutate<T extends { error: string } | object>(write: () => Promise<T>, apply: (value: Exclude<T, { error: string }>, before: FolderWorkspace) => FolderWorkspace) {
    if (!scope || locked.current) return false;
    locked.current = true;
    const startedEpoch = sessionEpoch.current;
    generation.current += 1;
    setWorking(key);
    setFailure({ key, message: "", source: "" });
    try {
      const result = await write();
      if (currentKey.current !== key || sessionEpoch.current !== startedEpoch) return false;
      if ("error" in result) { setFailure({ key, message: String(result.error), source: "write" }); retry(); return false; }
      setState(previous => previous.key === key ? { key, workspace: apply(result as Exclude<T, { error: string }>, previous.workspace) } : previous);
      emitCoupleActivitiesChanged();
      return true;
    } catch {
      if (currentKey.current === key && sessionEpoch.current === startedEpoch) setFailure({ key, message: "변경 내용을 저장하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.", source: "write" });
      return false;
    } finally {
      if (currentKey.current === key && sessionEpoch.current === startedEpoch) { locked.current = false; setWorking(""); retry(); }
    }
  }
  return {
    workspace, selectedFolderId, setSelectedFolderId, matchesFolder, folderFor, error, pending,
    reload: () => { if (scope) { retry(); void refresh(); } },
    moveItems: (ids: string[], folderId: string | null) => mutate(() => moveFolderItems(scope!, ids, folderId), (_, before) => moveMemberships(before, ids, folderId)),
    create: (input: { name: string; color: ArchiveFolder["color"]; attemptId: string }) => mutate(() => createFolder(scope!, input), (result, before) => ({ ...before, folders: [...before.folders.filter(folder => folder.id !== result.folder.id), result.folder] })),
    rename: (folder: ArchiveFolder, input: { name: string; color: ArchiveFolder["color"] }) => mutate(() => renameFolder(scope!, folder.id, input, folder.updatedAt), (result, before) => ({ ...before, folders: before.folders.map(item => item.id === folder.id ? result.folder : item) })),
    remove: (folder: ArchiveFolder) => mutate(() => deleteFolder(scope!, folder.id, folder.updatedAt), (_, before) => ({ ...before, folders: before.folders.filter(item => item.id !== folder.id), memberships: before.memberships.filter(item => item.folderId !== folder.id) })),
  };
}
export type FolderController = ReturnType<typeof useFolderWorkspace>;
