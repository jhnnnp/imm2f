export type FolderScope = "vault" | "places";
/** Root displays folders; All is an explicit view of every saved item. */
export type FolderSelection = "root" | "all" | "unfiled" | string;
export const FOLDER_COLORS = ["sage", "blue", "rose", "sand", "lavender"] as const;
export type FolderColor = typeof FOLDER_COLORS[number];
export type ArchiveFolder = { id: string; name: string; color: FolderColor; createdAt: string; updatedAt: string };
export type FolderWorkspace = { folders: ArchiveFolder[]; memberships: { itemId: string; folderId: string }[]; persist: boolean };
export const EMPTY_FOLDER_WORKSPACE: FolderWorkspace = { folders: [], memberships: [], persist: false };
export const FOLDER_DRAG_MIME = "application/x-only-us-folder-items";
