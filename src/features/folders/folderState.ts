import { FOLDER_COLORS, type FolderScope, type FolderWorkspace } from "./types";

export function validFolderScope(value: unknown): value is FolderScope { return value === "vault" || value === "places"; }
export function validFolderId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function validFolderInput(value: unknown): value is { name: string; color: typeof FOLDER_COLORS[number] } {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return typeof input.name === "string" && input.name.trim().length > 0 && input.name.trim().length <= 40
    && !/[\u0000-\u001f\u007f]/.test(input.name) && FOLDER_COLORS.includes(input.color as typeof FOLDER_COLORS[number]);
}
export function moveMemberships(workspace: FolderWorkspace, ids: string[], folderId: string | null): FolderWorkspace {
  const moving = new Set(ids);
  return { ...workspace, memberships: [...workspace.memberships.filter(entry => !moving.has(entry.itemId)),
    ...(folderId ? [...moving].map(itemId => ({ itemId, folderId })) : [])] };
}
export function readFolderDrop(payload: string, scope: FolderScope, itemIds: ReadonlySet<string>): string[] {
  if (payload.length > 40_000) return [];
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object") return [];
    const input = value as Record<string, unknown>;
    if (input.scope !== scope || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 500
      || input.ids.some(id => typeof id !== "string" || !itemIds.has(id))) return [];
    return [...new Set(input.ids)] as string[];
  } catch { return []; }
}
