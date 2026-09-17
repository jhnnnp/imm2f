"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { createPlace, saveKakaoPlace } from "../actions";
import type { DiscoverCandidate, Place, PlaceCategoryId } from "../types/place";

export function PlaceCreateDialog({
  open,
  mode,
  persist,
  candidate,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "confirm" | "manual";
  persist: boolean;
  candidate: DiscoverCandidate | null;
  onClose: () => void;
  onSaved: (place: Place, notice: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setPending(false);
  }, [open, mode, candidate?.externalPlaceId]);

  if (!open || !mounted) return null;

  async function confirmKakao(formData: FormData) {
    if (!candidate) return;
    setPending(true);
    setError("");
    const description = String(formData.get("description") ?? "").trim();

    if (!persist) {
      setPending(false);
      setError("로그인 후 장소를 저장할 수 있어요.");
      return;
    }

    const result = await saveKakaoPlace({ candidate, description, durationMinutes: 60, expectedCostTwo: null });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.place, result.duplicate ? `${result.place.name}은 이미 저장된 장소예요.` : `${result.place.name}을 우리의 장소에 저장했어요.`);
    onClose();
  }

  async function submitManual(formData: FormData) {
    setPending(true);
    setError("");
    const input = {
      name: String(formData.get("name") ?? ""),
      category: String(formData.get("category") ?? "cafe") as PlaceCategoryId,
      district: String(formData.get("district") ?? ""),
      description: String(formData.get("description") ?? ""),
      durationMinutes: 60,
      expectedCostTwo: null,
    };

    if (!persist) {
      setPending(false);
      setError("로그인 후 장소를 저장할 수 있어요.");
      return;
    }

    const result = await createPlace(input);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.place, `${result.place.name}을 우리의 장소에 저장했어요.`);
    onClose();
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div className="place-create-dialog" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="place-create-title">
        <span className="eyebrow">NEW PLACE</span>
        <h2 id="place-create-title">{mode === "manual" ? "직접 입력" : "이 장소 저장"}</h2>

        {mode === "confirm" && candidate && (
          <form className="auth-form" action={formData => void confirmKakao(formData)}>
            <div className="kakao-picked">
              <b>{candidate.name}</b>
              <small>{candidate.categoryLabel} · {candidate.roadAddress || candidate.address}</small>
            </div>
            <label className="field">
              <span>우리의  메모</span>
              <textarea name="description" rows={3} placeholder="이 장소에서 하고 싶은 것, 기억하고 싶은 것" />
            </label>
            <p className="form-hint">저장하기 전까지는 목록에만 보여요.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose}>닫기</button>
              <button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}

        {mode === "manual" && (
          <form className="auth-form" action={formData => void submitManual(formData)}>
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
              <textarea name="description" rows={3} placeholder="둘에게 이 장소가 특별한 이유" />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose}>닫기</button>
              <button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
