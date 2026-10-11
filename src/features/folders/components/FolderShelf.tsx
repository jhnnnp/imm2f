"use client";

import { useId, useMemo, useState, type DragEvent } from "react";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import { readFolderDrop } from "../folderState";
import { FOLDER_COLORS, FOLDER_DRAG_MIME, type ArchiveFolder, type FolderColor, type FolderScope } from "../types";
import type { FolderController } from "../useFolderWorkspace";
import "../folders.css";

const COLOR_NAMES: Record<FolderColor, string> = { sage: "숲", blue: "하늘", rose: "장미", sand: "모래", lavender: "라벤더" };
type ShelfItem = { id: string; title: string; image?: string };
type Dialog = { mode: "create"; attemptId: string } | { mode: "edit" | "delete"; folder: ArchiveFolder };

function FolderArt({ items, color }: { items: ShelfItem[]; color: string }) {
  return <span className={`folder-art folder-color-${color}`} aria-hidden="true">
    <span className="folder-back" />
    <span className="folder-paper"><span>{items[0]?.title ?? "우리의 작은 모음"}</span><i /><i /></span>
    {items[0]?.image && /^(https?:\/\/|\/)/.test(items[0].image) && <span className="folder-photo"><img src={items[0].image} alt="" loading="lazy" /></span>}
    <span className="folder-front"><svg viewBox="0 0 24 24" fill="none"><path d="M12 19s-7-4.3-7-9a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 4.7-7 9-7 9Z" stroke="currentColor" strokeWidth="1.4" /></svg></span>
  </span>;
}

export function FolderShelf({ scope, controller, items, label }: {
  scope: FolderScope; controller: FolderController; items: ShelfItem[]; label: string;
}) {
  const { workspace, selectedFolderId, setSelectedFolderId, pending, error } = controller;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<FolderColor>("sage");
  const [dragOver, setDragOver] = useState("");
  const [notice, setNotice] = useState("");
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useDialogFocus<HTMLFormElement>({ open: !!dialog, onClose: () => { if (!pending) setDialog(null); }, initialFocus: dialog?.mode === "delete" ? '[data-folder-cancel]' : 'input' });
  const itemIds = useMemo(() => new Set(items.map(item => item.id)), [items]);
  const groups = useMemo(() => {
    const byId = new Map(items.map(item => [item.id, item]));
    const assigned = new Set<string>();
    const folderIds = new Set(workspace.folders.map(folder => folder.id));
    const result = new Map<string, ShelfItem[]>();
    for (const entry of workspace.memberships) {
      const item = byId.get(entry.itemId);
      if (!item || !folderIds.has(entry.folderId) || assigned.has(item.id)) continue;
      assigned.add(item.id);
      const folderItems = result.get(entry.folderId) ?? [];
      folderItems.push(item);
      result.set(entry.folderId, folderItems);
    }
    result.set("unfiled", items.filter(item => !assigned.has(item.id)));
    return result;
  }, [items, workspace.memberships, workspace.folders]);
  const currentFolder = workspace.folders.find(folder => folder.id === selectedFolderId);
  function open(next: Dialog) {
    setName("folder" in next ? next.folder.name : "");
    setColor("folder" in next ? next.folder.color : "sage");
    setNotice("");
    setDialog(next);
  }
  async function submit() {
    if (!dialog || pending) return;
    const okay = dialog.mode === "create" ? await controller.create({ name, color, attemptId: dialog.attemptId })
      : dialog.mode === "edit" ? await controller.rename(dialog.folder, { name, color }) : await controller.remove(dialog.folder);
    if (okay) { setDialog(null); setNotice(dialog.mode === "delete" ? "폴더를 지웠어요. 안의 항목은 미분류에 남아 있어요." : "폴더를 저장했어요."); }
  }
  function acceptDrag(event: DragEvent, target: string) {
    if (pending || !workspace.persist || !event.dataTransfer.types.includes(FOLDER_DRAG_MIME)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(target);
  }
  async function drop(event: DragEvent, target: string) {
    event.preventDefault(); setDragOver("");
    if (pending || !workspace.persist) return;
    const ids = readFolderDrop(event.dataTransfer.getData(FOLDER_DRAG_MIME), scope, itemIds);
    if (!ids.length) return;
    if (await controller.moveItems(ids, target === "unfiled" ? null : target)) setNotice(`${ids.length}개 항목을 ${target === "unfiled" ? "미분류로" : "폴더에"} 옮겼어요.`);
  }
  return <section className={`folder-shelf ${scope === "places" ? "folder-shelf-sage" : "folder-shelf-blue"} ${selectedFolderId !== "all" ? "folder-shelf-inside" : ""}`} aria-label={`${label} 폴더`}>
    <div className="folder-shelf-heading"><div><span className="folder-eyebrow">OUR LITTLE COLLECTIONS</span><h2>우리만의 폴더</h2><p>이름을 붙이면, 함께 모은 순간들이 더 특별해져요.</p></div>
      <button className="folder-new" type="button" disabled={pending || !workspace.persist} onClick={() => open({ mode: "create", attemptId: crypto.randomUUID() })}>＋ 새 폴더</button></div>
    <nav className="folder-breadcrumb" aria-label="폴더 위치">
      <button type="button" aria-current={selectedFolderId === "all" ? "page" : undefined} onClick={() => setSelectedFolderId("all")}>전체 {label} <span>{items.length}</span></button>
      {selectedFolderId !== "all" && <><span aria-hidden="true">/</span><strong>{currentFolder?.name ?? "미분류"}</strong></>}
    </nav>
    <div className="folder-grid">
      <article className={`folder-tile folder-unfiled ${selectedFolderId === "unfiled" ? "is-selected" : ""} ${dragOver === "unfiled" ? "is-drag-over" : ""}`}
        onDragOver={event => acceptDrag(event, "unfiled")} onDragLeave={() => setDragOver("")} onDrop={event => void drop(event, "unfiled")}>
        <button type="button" className="folder-open" aria-pressed={selectedFolderId === "unfiled"} onClick={() => setSelectedFolderId("unfiled")}>
          <FolderArt items={groups.get("unfiled") ?? []} color="neutral" /><span className="folder-name">미분류</span><span className="folder-count">{groups.get("unfiled")?.length ?? 0}개 · 아직 이름 없는 모음</span>
        </button>
      </article>
      {workspace.folders.map(folder => <article key={folder.id} className={`folder-tile ${selectedFolderId === folder.id ? "is-selected" : ""} ${dragOver === folder.id ? "is-drag-over" : ""}`}
        onDragOver={event => acceptDrag(event, folder.id)} onDragLeave={() => setDragOver("")} onDrop={event => void drop(event, folder.id)}>
        <button className="folder-open" type="button" aria-label={`${folder.name} 폴더 열기`} aria-pressed={selectedFolderId === folder.id} onClick={() => setSelectedFolderId(folder.id)}>
          <FolderArt items={groups.get(folder.id) ?? []} color={folder.color} /><span className="folder-name">{folder.name}</span><span className="folder-count">{groups.get(folder.id)?.length ?? 0}개 함께 보관 중</span>
        </button>
        <button className="folder-edit" type="button" disabled={pending || !workspace.persist} aria-label={`${folder.name} 폴더 관리`} onClick={() => open({ mode: "edit", folder })}>⋯</button>
      </article>)}
    </div>
    <div className="folder-shelf-foot"><span>항목을 폴더로 끌어 놓거나 ‘폴더로 이동’을 선택해 주세요.</span><span>두 사람이 함께 정리하는 공간</span></div>
    {notice && <p className="folder-notice" role="status">{notice}</p>}
    {error && <div className="folder-error" role="alert">{error} <button type="button" disabled={pending} onClick={() => controller.reload()}>다시 불러오기</button></div>}
    {dialog && <div className="folder-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget && !pending) setDialog(null); }}>
      <form ref={dialogRef} className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="folder-dialog-top"><h2 id={titleId}>{dialog.mode === "create" ? "새로운 모음을 만들어요" : dialog.mode === "delete" ? "폴더를 지울까요?" : "폴더에 이름을 붙여요"}</h2><button type="button" disabled={pending} aria-label="폴더 창 닫기" onClick={() => setDialog(null)}>×</button></div>
        {dialog.mode === "delete" ? <p><strong>{dialog.folder.name}</strong> 폴더만 지워져요. 안에 담긴 항목은 삭제되지 않고 미분류로 옮겨져요.</p> : <>
          <FolderArt items={[]} color={color} /><label htmlFor={inputId}>폴더 이름</label><input id={inputId} value={name} onChange={event => setName(event.target.value)} maxLength={40} required placeholder={scope === "places" ? "예: 비 오는 날의 데이트" : "예: 우리의 가을 여행"} disabled={pending} />
          <fieldset disabled={pending}><legend>폴더 색상</legend><div className="folder-color-picker">{FOLDER_COLORS.map(choice => <label key={choice} className={`folder-swatch folder-color-${choice}`}><input type="radio" name={`${inputId}-color`} checked={choice === color} value={choice} onChange={() => setColor(choice)} /><span aria-hidden="true">{choice === color ? "✓" : ""}</span><small>{COLOR_NAMES[choice]}</small></label>)}</div></fieldset>
        </>}
        {error && <p role="alert" className="folder-error">{error}</p>}
        <div className="folder-dialog-actions">
          {dialog.mode === "edit" && <button className="folder-delete" type="button" disabled={pending} onClick={() => setDialog({ mode: "delete", folder: dialog.folder })}>폴더 삭제</button>}
          <button type="button" data-folder-cancel disabled={pending} onClick={() => setDialog(null)}>취소</button><button className="folder-primary" type="submit" disabled={pending || dialog.mode !== "delete" && !name.trim()}>{pending ? "저장 중…" : dialog.mode === "delete" ? "폴더만 삭제" : "저장"}</button>
        </div>
      </form>
    </div>}
  </section>;
}
