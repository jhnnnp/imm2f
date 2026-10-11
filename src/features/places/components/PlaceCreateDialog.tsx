"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { createPlace, saveKakaoPlace } from "../actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import type { DiscoverCandidate, Place, PlaceCategoryId } from "../types/place";
import { withObjectParticle } from "@/lib/korean";
import { manualPlaceAttempt, type ManualPlaceAttempt } from "../manualPlaceAttempt";
import type { ArchiveFolder } from "@/features/folders/types";
import { useDialogFocus } from "@/components/shared/useDialogFocus";

export function PlaceCreateDialog({
  open,
  mode,
  persist,
  candidate,
  initialDescription = "",
  folders = [],
  initialFolderId = null,
  onClose,
  onSaved,
  onPendingChange,
}: {
  open: boolean;
  mode: "confirm" | "manual";
  persist: boolean;
  candidate: DiscoverCandidate | null;
  initialDescription?: string;
  folders?: ArchiveFolder[];
  initialFolderId?: string | null;
  onClose: () => void;
  onSaved: (place: Place, notice: string, folderId: string | null) => void | Promise<void>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [description, setDescription] = useState("");
  const [mounted, setMounted] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);
  const [committed, setCommitted] = useState(false);
  const [manualDraft, setManualDraft] = useState({ name: "", category: "cafe" as PlaceCategoryId, district: "", description: "" });
  const manualAttempt = useRef<ManualPlaceAttempt | null>(null);
  const pendingRef = useRef(false);
  const openedRef = useRef(false);
  const pendingChangeRef = useRef(onPendingChange);
  pendingChangeRef.current = onPendingChange;
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: open && mounted, onClose: () => { if (!pendingRef.current) onClose(); } });
  const selectedFolderId = folderId && folders.some(folder => folder.id === folderId) ? folderId : null;

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open && !openedRef.current) {
      setFolderId(initialFolderId);
      setCommitted(false);
    }
    openedRef.current = open;
  }, [open, initialFolderId]);

  useEffect(() => {
    if (!open) {
      setDescription("");
      setError("");
      if (!pendingRef.current) {
        setPending(false);
        pendingChangeRef.current?.(false);
      }
      return;
    }
    setDescription(mode === "confirm" ? initialDescription : "");
    setError("");
  }, [open, mode, candidate?.externalPlaceId, candidate?.externalSource, initialDescription]);

  function setSavePending(next: boolean) {
    pendingRef.current = next;
    setPending(next);
    pendingChangeRef.current?.(next);
  }

  if (!open || !mounted) return null;

  async function finishSaved(place: Place, notice: string, targetFolderId: string | null) {
    // The place is already committed. A later folder/list failure must never
    // offer a second place creation as though the original save failed.
    setCommitted(true);
    let completed = false;
    try {
      await onSaved(place, notice, targetFolderId);
      completed = true;
    } catch {
      setError("장소는 저장됐지만 목록 정리를 마치지 못했어요. 창을 닫고 저장한 장소를 확인해 주세요.");
    } finally {
      emitCoupleActivitiesChanged();
      setSavePending(false);
    }
    if (completed) onClose();
  }

  async function confirmKakao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidate || pendingRef.current || committed) return;
    setSavePending(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    const nextDescription = String(formData.get("description") ?? description).trim();
    const targetFolderId = selectedFolderId;

    if (!persist) {
      setSavePending(false);
      setError("로그인 후 장소를 저장할 수 있어요.");
      return;
    }

    const result = await saveKakaoPlace({ candidate, description: nextDescription, durationMinutes: 60, expectedCostTwo: null })
      .catch(() => ({ error: "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요." }));
    if ("error" in result) {
      setSavePending(false);
      setError(result.error);
      return;
    }
    await finishSaved(result.place, result.duplicate ? `${result.place.name}은 이미 저장된 장소예요.` : `${withObjectParticle(result.place.name)} 우리의 장소에 저장했어요.`, targetFolderId);
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || committed) return;
    setSavePending(true);
    setError("");
    const input = {
      ...manualDraft,
      durationMinutes: 60,
      expectedCostTwo: null,
    };
    const targetFolderId = selectedFolderId;

    if (!persist) {
      setSavePending(false);
      setError("로그인 후 장소를 저장할 수 있어요.");
      return;
    }

    manualAttempt.current = manualPlaceAttempt(manualAttempt.current, input);
    const result = await createPlace({ ...input, attemptId: manualAttempt.current.id })
      .catch(() => ({ error: "저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도하면 이어서 저장해요." }));
    if ("error" in result) {
      setSavePending(false);
      setError(result.error);
      return;
    }
    manualAttempt.current = null;
    setManualDraft({ name: "", category: "cafe", district: "", description: "" });
    await finishSaved(result.place, `${withObjectParticle(result.place.name)} 우리의 장소에 저장했어요.`, targetFolderId);
  }

  const folderField = <label className="field">
    <span>저장할 폴더</span>
    <select name="folderId" value={selectedFolderId ?? ""} onChange={event => setFolderId(event.target.value || null)} disabled={pending || committed} data-dialog-autofocus={mode === "confirm" ? true : undefined}>
      <option value="">미분류</option>
      {folders.map(folder => <option value={folder.id} key={folder.id}>{folder.name}</option>)}
    </select>
  </label>;

  return createPortal(
    <div className="dialog-backdrop" onClick={() => { if (!pendingRef.current) onClose(); }} role="presentation">
      <div ref={dialogRef} tabIndex={-1} className="place-create-dialog" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="place-create-title">
        <span className="eyebrow">NEW PLACE</span>
        <h2 id="place-create-title">{mode === "manual" ? "직접 입력해 장소 저장하기" : "이 장소를 어디에 저장할까요?"}</h2>

        {mode === "confirm" && candidate && (
          <form className="auth-form" key={`confirm-${candidate.externalSource}-${candidate.externalPlaceId}`} onSubmit={event => void confirmKakao(event)} aria-busy={pending}>
            <div className="kakao-picked">
              <b>{candidate.name}</b>
              <small>{candidate.categoryLabel} · {candidate.roadAddress || candidate.address}</small>
            </div>
            {folderField}
            <label className="field">
              <span>우리의 메모</span>
              <textarea name="description" rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="이 장소에서 하고 싶은 것, 기억하고 싶은 것" disabled={pending || committed} />
            </label>
            <p className="form-hint">장소와 메모를 함께 보관해요. 폴더는 저장한 뒤에도 바꿀 수 있어요.</p>
            {pending && <div className="place-save-progress" role="status" aria-live="assertive"><i className="modal-spinner" aria-hidden="true" /><span><b>우리의 장소에 저장하고 있어요</b><small>잠시만 기다려 주세요.</small></span></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose} disabled={pending}>닫기</button>
              <button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending || committed} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "저장 중..." : committed ? "저장 완료" : "장소 저장하기"}</button>
            </div>
          </form>
        )}

        {mode === "manual" && (
          <form className="auth-form" key="manual-place" onSubmit={event => void submitManual(event)} aria-busy={pending}>
            <p className="form-hint">검색에서 못 찾은 장소만 직접 입력해요.</p>
            <label className="field">
              <span>이름</span>
              <input data-dialog-autofocus name="name" required placeholder="장소 이름" value={manualDraft.name} onChange={event => setManualDraft(current => ({ ...current, name: event.target.value }))} disabled={pending || committed} />
            </label>
            <label className="field">
              <span>카테고리</span>
              <select name="category" value={manualDraft.category} onChange={event => setManualDraft(current => ({ ...current, category: event.target.value as PlaceCategoryId }))} disabled={pending || committed}>
                {PLACE_CATEGORIES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>동네</span>
              <input name="district" placeholder="서울 성수동" value={manualDraft.district} onChange={event => setManualDraft(current => ({ ...current, district: event.target.value }))} disabled={pending || committed} />
            </label>
            {folderField}
            <label className="field">
              <span>우리의 메모</span>
              <textarea name="description" rows={3} value={manualDraft.description} onChange={event => setManualDraft(current => ({ ...current, description: event.target.value }))} placeholder="둘에게 이 장소가 특별한 이유" disabled={pending || committed} />
            </label>
            {pending && <div className="place-save-progress" role="status" aria-live="assertive"><i className="modal-spinner" aria-hidden="true" /><span><b>주소와 장소 정보를 저장하고 있어요</b><small>위치까지 확인한 뒤 목록에 추가할게요.</small></span></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose} disabled={pending}>닫기</button>
              <button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending || committed} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "저장 중..." : committed ? "저장 완료" : "장소 저장하기"}</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
