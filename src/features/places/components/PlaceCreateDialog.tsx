"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { createPlace, saveKakaoPlace } from "../actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import type { DiscoverCandidate, Place, PlaceCategoryId } from "../types/place";
import { withObjectParticle } from "@/lib/korean";

export function PlaceCreateDialog({
  open,
  mode,
  persist,
  candidate,
  initialDescription = "",
  onClose,
  onSaved,
  onPendingChange,
}: {
  open: boolean;
  mode: "confirm" | "manual";
  persist: boolean;
  candidate: DiscoverCandidate | null;
  initialDescription?: string;
  onClose: () => void;
  onSaved: (place: Place, notice: string) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [description, setDescription] = useState("");
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setDescription("");
      setError("");
      setPending(false);
      onPendingChange?.(false);
      return;
    }
    setDescription(mode === "confirm" ? initialDescription : "");
    setError("");
    setPending(false);
    onPendingChange?.(false);
  }, [open, mode, candidate?.externalPlaceId, candidate?.externalSource, initialDescription, onPendingChange]);

  function setSavePending(next: boolean) {
    setPending(next);
    onPendingChange?.(next);
  }

  if (!open || !mounted) return null;

  async function confirmKakao(formData: FormData) {
    if (!candidate) return;
    setSavePending(true);
    setError("");
    const nextDescription = String(formData.get("description") ?? description).trim();

    if (!persist) {
      setSavePending(false);
      setError("로그인 후 장소를 저장할 수 있어요.");
      return;
    }

    const result = await saveKakaoPlace({ candidate, description: nextDescription, durationMinutes: 60, expectedCostTwo: null })
      .catch(() => ({ error: "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요." }));
    setSavePending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.place, result.duplicate ? `${result.place.name}은 이미 저장된 장소예요.` : `${withObjectParticle(result.place.name)} 우리의 장소에 저장했어요.`);
    emitCoupleActivitiesChanged();
    onClose();
  }

  async function submitManual(formData: FormData) {
    setSavePending(true);
    setError("");
    const input = {
      name: String(formData.get("name") ?? ""),
      category: String(formData.get("category") ?? "cafe") as PlaceCategoryId,
      district: String(formData.get("district") ?? ""),
      description: String(formData.get("description") ?? description).trim(),
      durationMinutes: 60,
      expectedCostTwo: null,
    };

    if (!persist) {
      setSavePending(false);
      setError("로그인 후 장소를 저장할 수 있어요.");
      return;
    }

    const result = await createPlace(input)
      .catch(() => ({ error: "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요." }));
    setSavePending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.place, `${withObjectParticle(result.place.name)} 우리의 장소에 저장했어요.`);
    emitCoupleActivitiesChanged();
    onClose();
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={() => { if (!pending) onClose(); }} role="presentation">
      <div className="place-create-dialog" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="place-create-title">
        <span className="eyebrow">NEW PLACE</span>
        <h2 id="place-create-title">{mode === "manual" ? "직접 입력" : "이 장소 저장"}</h2>

        {mode === "confirm" && candidate && (
          <form className="auth-form" key={`confirm-${candidate.externalSource}-${candidate.externalPlaceId}`} action={formData => void confirmKakao(formData)} aria-busy={pending}>
            <div className="kakao-picked">
              <b>{candidate.name}</b>
              <small>{candidate.categoryLabel} · {candidate.roadAddress || candidate.address}</small>
            </div>
            <label className="field">
              <span>우리의  메모</span>
              <textarea name="description" rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="이 장소에서 하고 싶은 것, 기억하고 싶은 것" />
            </label>
            <p className="form-hint">저장하기 전까지는 목록에만 보여요.</p>
            {pending && <div className="place-save-progress" role="status" aria-live="assertive"><i className="modal-spinner" aria-hidden="true" /><span><b>우리의 장소에 저장하고 있어요</b><small>잠시만 기다려 주세요.</small></span></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose} disabled={pending}>닫기</button>
              <button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}

        {mode === "manual" && (
          <form className="auth-form" key="manual-place" action={formData => void submitManual(formData)} aria-busy={pending}>
            <p className="form-hint">검색에서 못 찾은 장소만 직접 입력해요.</p>
            <label className="field">
              <span>이름</span>
              <input name="name" required placeholder="장소 이름" />
            </label>
            <label className="field">
              <span>카테고리</span>
              <select name="category" defaultValue="cafe">
                {PLACE_CATEGORIES.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>동네</span>
              <input name="district" placeholder="서울 성수동" />
            </label>
            <label className="field">
              <span>우리의  메모</span>
              <textarea name="description" rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="둘에게 이 장소가 특별한 이유" />
            </label>
            {pending && <div className="place-save-progress" role="status" aria-live="assertive"><i className="modal-spinner" aria-hidden="true" /><span><b>주소와 장소 정보를 저장하고 있어요</b><small>위치까지 확인한 뒤 목록에 추가할게요.</small></span></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose} disabled={pending}>닫기</button>
              <button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
