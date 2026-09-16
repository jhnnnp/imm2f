"use client";

import { useEffect, useState } from "react";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { createPlace, saveKakaoPlace } from "../actions";
import { visualToneForCategory } from "../mappers";
import type { DiscoverCandidate, Place, PlaceCategoryId } from "../types/place";
import { withObjectParticle } from "@/lib/korean";

const STAY_OPTIONS = [
  { minutes: 30, label: "30분" },
  { minutes: 60, label: "1시간" },
  { minutes: 90, label: "1시간 30분" },
  { minutes: 120, label: "2시간" },
  { minutes: 180, label: "3시간" },
] as const;

export function PlaceCreateDialog({
  open,
  mode,
  persist,
  candidate,
  savedKakaoIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "confirm" | "manual";
  persist: boolean;
  candidate: DiscoverCandidate | null;
  savedKakaoIds: string[];
  onClose: () => void;
  onSaved: (place: Place, notice: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setPending(false);
  }, [open, mode, candidate?.externalPlaceId]);

  if (!open) return null;

  function localFromCandidate(item: DiscoverCandidate, description: string, durationMinutes: number, expectedCostTwo: number | null): Place {
    const source = item.externalSource === "tourapi" ? "tourapi" : "kakao";
    return {
      id: `${source}-${item.externalPlaceId}`,
      name: item.name,
      category: item.category,
      categoryLabel: item.categoryLabel,
      district: item.district,
      address: item.address,
      roadAddress: item.roadAddress,
      mapUrl: item.mapUrl,
      phone: item.phone,
      openingHours: item.openingHours ?? null,
      description,
      durationMinutes,
      expectedCostTwo,
      coordinates: item.coordinates,
      image: item.image,
      visualTone: visualToneForCategory(item.category),
      userStatus: "want",
      partnerStatus: "neutral",
      userFit: 0,
      partnerFit: 0,
      externalSource: source,
      externalPlaceId: item.externalPlaceId,
    };
  }

  async function confirmKakao(formData: FormData) {
    if (!candidate) return;
    setPending(true);
    setError("");
    const description = String(formData.get("description") ?? "").trim();
    const durationMinutes = Number(formData.get("durationMinutes") ?? 60);
    const costRaw = String(formData.get("expectedCostTwo") ?? "").trim();
    const expectedCostTwo = costRaw === "" ? null : Number(costRaw);

    if (!persist) {
      if (savedKakaoIds.includes(`${candidate.externalSource}:${candidate.externalPlaceId}`) || savedKakaoIds.includes(candidate.externalPlaceId)) {
        setPending(false);
        onSaved(localFromCandidate(candidate, description, durationMinutes, expectedCostTwo), `${candidate.name}은 이미 저장된 장소예요.`);
        onClose();
        return;
      }
      onSaved(
        localFromCandidate(candidate, description, durationMinutes, expectedCostTwo),
        `${withObjectParticle(candidate.name)} 이 기기에 저장했어요. 데모를 나가기 전까지 유지돼요.`,
      );
      setPending(false);
      onClose();
      return;
    }

    const result = await saveKakaoPlace({ candidate, description, durationMinutes, expectedCostTwo });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.place, result.duplicate ? `${result.place.name}은 이미 저장된 장소예요.` : `${result.place.name}을 둘의 장소에 저장했어요.`);
    onClose();
  }

  async function submitManual(formData: FormData) {
    setPending(true);
    setError("");
    const costRaw = String(formData.get("expectedCostTwo") ?? "").trim();
    const input = {
      name: String(formData.get("name") ?? ""),
      category: String(formData.get("category") ?? "cafe") as PlaceCategoryId,
      district: String(formData.get("district") ?? ""),
      description: String(formData.get("description") ?? ""),
      durationMinutes: Number(formData.get("durationMinutes") ?? 60),
      expectedCostTwo: costRaw === "" ? null : Number(costRaw),
    };

    if (!persist) {
      const local: Place = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        category: input.category,
        categoryLabel: PLACE_CATEGORIES.find(item => item.id === input.category)?.label ?? "장소",
        district: input.district.trim(),
        description: input.description.trim(),
        durationMinutes: input.durationMinutes,
        expectedCostTwo: input.expectedCostTwo,
        coordinates: null,
        visualTone: visualToneForCategory(input.category),
        userStatus: "want",
        partnerStatus: "neutral",
        userFit: 0,
        partnerFit: 0,
        externalSource: "manual",
      };
      onSaved(local, `${withObjectParticle(local.name)} 이 기기에 저장했어요. 데모를 나가기 전까지 유지돼요.`);
      setPending(false);
      onClose();
      return;
    }

    const result = await createPlace(input);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.place, `${result.place.name}을 둘의 장소에 저장했어요.`);
    onClose();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div className="place-create-dialog" onClick={event => event.stopPropagation()}>
        <span className="eyebrow">NEW PLACE</span>
        <h2>{mode === "manual" ? "직접 입력" : "이 장소 저장"}</h2>

        {mode === "confirm" && candidate && (
          <form className="auth-form" action={formData => void confirmKakao(formData)}>
            <div className="kakao-picked">
              <b>{candidate.name}</b>
              <small>{candidate.categoryLabel} · {candidate.roadAddress || candidate.address}</small>
            </div>
            <label className="field">
              <span>둘만의 메모</span>
              <textarea name="description" rows={3} placeholder="이 장소에서 하고 싶은 것, 기억하고 싶은 것" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>예상 시간</span>
                <select name="durationMinutes" defaultValue="60">
                  {STAY_OPTIONS.map(item => <option value={item.minutes} key={item.minutes}>{item.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>예상 금액</span>
                <input name="expectedCostTwo" type="number" min={0} step={1000} placeholder="모르면 비워 두기" />
              </label>
            </div>
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
              <span>둘만의 메모</span>
              <textarea name="description" rows={3} placeholder="둘에게 이 장소가 특별한 이유" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>예상 시간</span>
                <select name="durationMinutes" defaultValue="60">
                  {STAY_OPTIONS.map(item => <option value={item.minutes} key={item.minutes}>{item.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>예상 금액</span>
                <input name="expectedCostTwo" type="number" min={0} step={1000} placeholder="모르면 비워 두기" />
              </label>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="outline-button" type="button" onClick={onClose}>닫기</button>
              <button className="primary-button" type="submit" disabled={pending}>{pending ? "저장 중..." : "저장"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
