"use client";

import { useEffect, useState } from "react";
import type { Place, PlacePreferenceStatus } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { STATUS_META } from "../config/statusMeta";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { kakaoPlaceUrl, naverPlaceSearchUrl } from "../format";
import { openPlaceMiniWindow } from "../openPlaceMini";
import { PlaceGraphicCover } from "./PlaceGraphicCover";
import { PlaceLocationMap } from "./PlaceLocationMap";

const STATUS_OPTIONS: PlacePreferenceStatus[] = ["want", "visited", "revisit", "not_interested"];
const HEART_SAVED: PlacePreferenceStatus[] = ["want", "must_visit", "revisit"];

function optionIsActive(current: PlacePreferenceStatus, option: PlacePreferenceStatus) {
  if (option === "want") return current === "want" || current === "must_visit";
  return current === option;
}

export function PlaceDetailPanel({
  place,
  onAdd,
  onAddDate,
  onStatusChange,
  onSave,
  onLocationSave,
  preferredPlan,
}: {
  place: Place;
  onAdd: () => void;
  onAddDate?: () => void;
  onStatusChange?: (status: PlacePreferenceStatus) => void;
  onSave?: () => void;
  onLocationSave?: (input: { address: string; district: string }) => Promise<{ error?: string } | void>;
  preferredPlan?: "trip" | "date" | null;
}) {
  const preview = isDiscoverPlace(place);
  const saved = HEART_SAVED.includes(place.userStatus);
  const address = place.roadAddress || place.address || place.district;
  const kakaoUrl = place.externalSource === "kakao" && place.mapUrl
    ? place.mapUrl
    : kakaoPlaceUrl(place.name, place.coordinates);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEditing(false);
    setPending(false);
    setError("");
  }, [place.id]);

  async function saveLocation(formData: FormData) {
    if (!onLocationSave) return;
    setPending(true);
    setError("");
    const result = await onLocationSave({
      address: String(formData.get("address") ?? ""),
      district: String(formData.get("district") ?? ""),
    });
    setPending(false);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    setEditing(false);
  }

  return <div className="place-detail-panel">
    <div className={`detail-photo tone-${place.visualTone} ${place.image ? "" : "is-empty"}`}>{place.image ? <img src={place.image} alt={place.name} /> : <PlaceGraphicCover place={place} />}<span>{place.categoryLabel.toUpperCase()} · {preview ? "CANDIDATE" : "PLACE"}</span></div>
    <div className="place-detail-head"><div><span className="eyebrow">{preview ? "PLACE PREVIEW" : "PLACE NOTE"}</span><h2>{place.name}</h2>
      {!editing && (
        <p>
          {address}
          {onLocationSave && <button className="place-edit-link" type="button" onClick={() => setEditing(true)}>수정</button>}
        </p>
      )}
    </div>{!preview && <button className={`detail-heart ${saved ? "is-on" : ""}`} type="button" aria-pressed={saved} aria-label={saved ? "가고 싶어요 해제" : "가고 싶어요"} onClick={() => onSave?.()}>{saved ? "♥" : "♡"}</button>}</div>
    {editing && (
      <form className="place-location-edit" action={formData => void saveLocation(formData)}>
        <label className="field">
          <span>주소</span>
          <input name="address" required defaultValue={place.roadAddress || place.address || ""} placeholder="전북 군산시 경촌4길 14" />
        </label>
        <label className="field">
          <span>동네</span>
          <input name="district" defaultValue={place.district} placeholder="군산시 경암동" />
        </label>
        <p className="form-hint">구석구석 위치가 어긋나면 주소로 카카오 좌표를 다시 맞춰요.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={() => { setEditing(false); setError(""); }}>취소</button>
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "맞추는 중..." : "위치 저장"}</button>
        </div>
      </form>
    )}
    {place.recommendReason ? <p className="detail-description">{place.recommendReason}</p> : place.description ? <p className="detail-description">{place.description}{place.description.endsWith(".") ? "" : "."}</p> : <p className="detail-description muted">{preview ? "저장하면 우리의  메모를 남길 수 있어요." : "아직 우리의  메모는 없어요."}</p>}
    {place.coordinates && <PlaceLocationMap name={place.name} coordinates={place.coordinates} />}
    {preview && (place.detailedCategory || place.openingHours || place.detailFacts?.length) && <dl className="place-api-facts">
      {place.detailedCategory && <div><dt>분류</dt><dd>{place.detailedCategory.split(">").map(item => item.trim()).filter(Boolean).slice(-2).join(" · ")}</dd></div>}
      {place.openingHours && <div><dt>{place.category === "festival" && !place.detailFacts?.some(fact => fact.label === "기간") ? "기간" : "이용시간"}</dt><dd>{place.openingHours}</dd></div>}
      {place.detailFacts?.map(fact => <div key={`${fact.label}-${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>}
    <div className="external-place-links">
      <span className="external-place-links-label">지도 앱으로 열기</span>
      <div className="map-app-grid">
        <button type="button" className="map-app-link is-kakao" onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")} aria-label="카카오맵에서 보기">
          <span className="map-service-lockup"><b className="kakao-wordmark">kakao map</b><small>보기</small></span><em aria-hidden="true">↗</em>
        </button>
        <button type="button" className="map-app-link is-naver" onClick={() => openPlaceMiniWindow(naverPlaceSearchUrl(place.name, address), "naver")} aria-label="네이버 지도에서 보기">
          <span className="map-service-lockup"><b className="naver-wordmark">NAVER</b><small>보기</small></span><em aria-hidden="true">↗</em>
        </button>
      </div>
      {place.externalSource === "tourapi" && place.mapUrl && <a className="place-source-link" href={place.mapUrl} target="_blank" rel="noreferrer">대한민국 구석구석 상세정보 <span>↗</span></a>}
      {place.homepage && <a className="place-source-link" href={place.homepage} target="_blank" rel="noreferrer">공식 홈페이지 <span>↗</span></a>}
    </div>
    {preview ? (
      <button className={preferredPlan ? "outline-button full" : "primary-button full"} type="button" onClick={onSave}>나중을 위해 저장</button>
    ) : (
      <div className="status-box"><span>내 마음</span>{onStatusChange ? <div className="status-picker" role="group" aria-label="이 장소에 대한 내 마음">{STATUS_OPTIONS.map(status => {
        const active = optionIsActive(place.userStatus, status);
        return <button type="button" className={`status-pill ${active ? "is-active" : ""}`} key={status} aria-pressed={active} onClick={() => onStatusChange(active ? "neutral" : status)}>{STATUS_META[status].label}</button>;
      })}</div> : <PlaceStatusBadge status={place.userStatus} />}<span>파트너</span><PlaceStatusBadge status={place.partnerStatus} /></div>
    )}
    {preferredPlan === "date" && onAddDate && <button className="primary-button full" type="button" onClick={onAddDate}>이 데이트에 추가</button>}
    {preferredPlan === "trip" && <button className="primary-button full" type="button" onClick={onAdd}>선택한 날에 추가</button>}
    {preferredPlan !== "trip" && <button className="outline-button full" type="button" onClick={onAdd}>여행 일정에 추가</button>}
    {preferredPlan !== "date" && onAddDate && <button className="outline-button full" type="button" onClick={onAddDate}>데이트 일정에 추가</button>}
  </div>;
}
