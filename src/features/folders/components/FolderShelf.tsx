"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
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
  const [dropFailure, setDropFailure] = useState("");
  const [movingTo, setMovingTo] = useState("");
  const [lastDropped, setLastDropped] = useState("");
  const [destinationsOpen, setDestinationsOpen] = useState(false);
  const dropLock = useRef(false);
  const titleId = useId();
  const inputId = useId();
  const destinationId = useId();
  const isRoot = selectedFolderId === "root";
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
  const locationName = currentFolder?.name ?? (selectedFolderId === "all" ? `전체 ${label}` : "미분류");
  useEffect(() => { setNotice(""); setDropFailure(""); setDragOver(""); setDestinationsOpen(false); }, [selectedFolderId]);
  useEffect(() => { if (pending) { setNotice(""); setDropFailure(""); } }, [pending]);
  useEffect(() => {
    const finishDrag = () => setDragOver("");
    const beginDrag = (event: Event) => {
      if ((event as CustomEvent<string>).detail === scope) { setDestinationsOpen(true); setNotice(""); setDropFailure(""); }
    };
    document.addEventListener("dragend", finishDrag);
    document.addEventListener("only-us:folder-drag", beginDrag);
    return () => { document.removeEventListener("dragend", finishDrag); document.removeEventListener("only-us:folder-drag", beginDrag); };
  }, [scope]);
  useEffect(() => {
    if (!lastDropped) return;
    const timer = window.setTimeout(() => setLastDropped(""), 1400);
    return () => window.clearTimeout(timer);
  }, [lastDropped]);
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
    if (pending || dropLock.current || !workspace.persist || !event.dataTransfer.types.includes(FOLDER_DRAG_MIME)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(target);
  }
  function leaveDrag(event: DragEvent) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragOver("");
  }
  async function drop(event: DragEvent, target: string) {
    event.preventDefault(); setDragOver("");
    if (pending || dropLock.current || !workspace.persist) return;
    setNotice(""); setDropFailure("");
    const ids = readFolderDrop(event.dataTransfer.getData(FOLDER_DRAG_MIME), scope, itemIds);
    if (!ids.length) { setDropFailure("이 폴더에 담을 수 있는 항목을 끌어 놓아 주세요."); return; }
    const destination = target === "unfiled" ? null : target;
    const movingIds = ids.filter(id => controller.folderFor(id) !== destination);
    if (!movingIds.length) { setNotice("선택한 항목은 이미 이 폴더에 있어요."); return; }
    dropLock.current = true;
    setMovingTo(target);
    try {
      if (await controller.moveItems(movingIds, destination)) {
        setNotice(`${movingIds.length}개 항목을 ${target === "unfiled" ? "미분류로" : "폴더에"} 옮겼어요.`);
        setLastDropped(target);
      } else setDropFailure("폴더 이동 결과를 확인하지 못했어요. 다시 불러온 뒤 확인해 주세요.");
    } catch {
      setDropFailure("폴더 이동 결과를 확인하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.");
    } finally { dropLock.current = false; setMovingTo(""); }
  }
  return <section className={`folder-shelf ${scope === "places" ? "folder-shelf-sage" : "folder-shelf-blue"} ${isRoot ? "folder-shelf-root" : "folder-shelf-inside"}`} aria-label={`${label} 폴더`} aria-busy={!!movingTo}>
    <div className="folder-shelf-heading"><div><span className="folder-eyebrow">OUR LITTLE COLLECTIONS</span><h2>{isRoot ? "우리만의 폴더" : locationName}</h2><p>{isRoot ? "폴더를 열어 함께 모은 장소와 기록을 둘러보세요." : "필요한 항목을 고르고, 마음에 맞는 폴더로 정리해요."}</p></div>
      <div className="folder-heading-actions"><button className={`folder-all-items${selectedFolderId === "all" ? " is-active" : ""}`} type="button" aria-pressed={selectedFolderId === "all"} onClick={() => setSelectedFolderId("all")}>전체 {label} 보기 <span>{items.length}</span></button>
      <button className="folder-new" type="button" disabled={pending || !workspace.persist} onClick={() => open({ mode: "create", attemptId: crypto.randomUUID() })}>＋ 새 폴더</button></div></div>
    <nav className="folder-breadcrumb" aria-label="폴더 위치">
      {!isRoot && <button className="folder-back-button" type="button" aria-label="폴더 목록으로 돌아가기" onClick={() => setSelectedFolderId("root")}>←</button>}
      <button type="button" aria-current={isRoot ? "page" : undefined} onClick={() => setSelectedFolderId("root")}>⌂ {label} 폴더</button>
      {!isRoot && <><span aria-hidden="true">/</span><strong>{locationName}</strong></>}
      <span className="folder-location-meta">{isRoot ? `${workspace.folders.length}개 폴더 · ${items.length}개 항목` : `${selectedFolderId === "all" ? items.length : groups.get(selectedFolderId)?.length ?? 0}개 항목`}</span>
    </nav>
    {!isRoot && <button className="folder-destinations-toggle" type="button" aria-expanded={destinationsOpen} aria-controls={destinationId} onClick={() => setDestinationsOpen(value => !value)}>⇄ 다른 폴더로 이동 <span>{destinationsOpen ? "접기" : "이동할 폴더 펼치기"}</span></button>}
    {(isRoot || destinationsOpen) && <div className="folder-grid" id={destinationId} aria-label={isRoot ? "폴더 목록" : "폴더 이동 대상"}>
      <article className={`folder-tile folder-unfiled ${selectedFolderId === "unfiled" ? "is-selected" : ""} ${dragOver === "unfiled" ? "is-drag-over" : ""} ${movingTo === "unfiled" ? "is-moving" : ""} ${lastDropped === "unfiled" ? "is-drop-complete" : ""}`}
        onDragOver={event => acceptDrag(event, "unfiled")} onDragLeave={leaveDrag} onDrop={event => void drop(event, "unfiled")}>
        <button type="button" className="folder-open" aria-pressed={selectedFolderId === "unfiled"} onClick={() => setSelectedFolderId("unfiled")}>
          <FolderArt items={groups.get("unfiled") ?? []} color="neutral" /><span className="folder-name">미분류</span><span className="folder-count">{groups.get("unfiled")?.length ?? 0}개 · 아직 이름 없는 모음</span>
        </button>
        {dragOver === "unfiled" && <span className="folder-drop-hint" aria-hidden="true">여기에 놓아 미분류로 이동</span>}
        {movingTo === "unfiled" && <span className="folder-drop-hint">옮기는 중…</span>}
      </article>
      {workspace.folders.map(folder => <article key={folder.id} className={`folder-tile ${selectedFolderId === folder.id ? "is-selected" : ""} ${dragOver === folder.id ? "is-drag-over" : ""} ${movingTo === folder.id ? "is-moving" : ""} ${lastDropped === folder.id ? "is-drop-complete" : ""}`}
        onDragOver={event => acceptDrag(event, folder.id)} onDragLeave={leaveDrag} onDrop={event => void drop(event, folder.id)}>
        <button className="folder-open" type="button" aria-label={`${folder.name} 폴더 열기`} aria-pressed={selectedFolderId === folder.id} onClick={() => setSelectedFolderId(folder.id)}>
          <FolderArt items={groups.get(folder.id) ?? []} color={folder.color} /><span className="folder-name">{folder.name}</span><span className="folder-count">{groups.get(folder.id)?.length ?? 0}개 함께 보관 중</span>
        </button>
        <button className="folder-edit" type="button" disabled={pending || !workspace.persist} aria-label={`${folder.name} 폴더 관리`} onClick={() => open({ mode: "edit", folder })}>⋯</button>
        {dragOver === folder.id && <span className="folder-drop-hint" aria-hidden="true">여기에 놓아 폴더에 담기</span>}
        {movingTo === folder.id && <span className="folder-drop-hint">옮기는 중…</span>}
      </article>)}
    </div>}
    {(isRoot || destinationsOpen) && <div className="folder-shelf-foot"><span>{isRoot ? "폴더를 클릭하거나 Enter를 눌러 열어요." : "선택한 항목을 폴더에 끌어 놓거나 ‘폴더로 이동’을 이용해요."}</span><span>두 사람이 함께 정리하는 공간</span></div>}
    {notice && <p className="folder-notice" role="status">{notice}</p>}
    {movingTo && <p className="folder-notice" role="status">항목을 옮기고 있어요. 저장이 끝나면 알려드릴게요.</p>}
    {dropFailure && <p className="folder-error" role="alert">{dropFailure} <button type="button" disabled={pending} onClick={() => { setDropFailure(""); controller.reload(); }}>이동 결과 다시 확인</button></p>}
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
