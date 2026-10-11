"use client";

import type { ArchiveFolder } from "../types";
import "../folders.css";

export function FolderMoveMenu({ folders, value, disabled, onMove }: {
  folders: ArchiveFolder[]; value: string | null; disabled: boolean; onMove: (folderId: string | null) => unknown;
}) {
  // A command select always starts on its placeholder, so a bulk selection can
  // explicitly move to Unfiled even when the represented current value is null.
  return <select className="folder-move-select" aria-label="폴더로 이동" value="" disabled={disabled}
    onChange={event => { const target = event.currentTarget.value; if (target) void onMove(target === "unfiled" ? null : target); }}>
    <option value="" disabled>폴더로 이동</option>
    <option value="unfiled">미분류로 이동</option>
    {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}{folder.id === value ? " · 현재 폴더" : ""}</option>)}
  </select>;
}
