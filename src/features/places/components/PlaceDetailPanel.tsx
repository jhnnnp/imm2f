import type { Place, PlacePreferenceStatus } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { STATUS_META } from "../config/statusMeta";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { formatOpeningHours, formatPlaceCost } from "../format";

const STATUS_OPTIONS: PlacePreferenceStatus[] = ["visited", "want", "must_visit", "revisit", "neutral", "dislike", "not_interested"];

export function PlaceDetailPanel({
  place,
  onAdd,
  onAddDate,
  onStatusChange,
  onSave,
}: {
  place: Place;
  onAdd: () => void;
  onAddDate?: () => void;
  onStatusChange?: (status: PlacePreferenceStatus) => void;
  onSave?: () => void;
}) {
  const preview = isDiscoverPlace(place);
  const address = place.roadAddress || place.address || place.district;
  const sourceLabel = place.externalSource === "tourapi" ? "관광정보에서 보기" : "카카오맵에서 보기";
  return <div className="place-detail-panel">
    <div className={`detail-photo tone-${place.visualTone}`}>{place.image ? <img src={place.image} alt={place.name} /> : <div className="abstract-photo large">{place.categoryLabel}<br />{preview ? "preview" : "memory"}</div>}<span>{place.categoryLabel.toUpperCase()} · {preview ? "CANDIDATE" : "PLACE"}</span></div>
    <div className="place-detail-head"><div><span className="eyebrow">{preview ? "PLACE PREVIEW" : "PLACE NOTE"}</span><h2>{place.name}</h2><p>{address}</p></div><button className={`detail-heart ${preview ? "" : "is-on"}`} type="button" aria-label={preview ? "이 장소 저장" : "가고 싶어요 해제"} onClick={() => onSave?.()}>♥</button></div>
    {place.recommendReason ? <p className="detail-description">{place.recommendReason}</p> : place.description ? <p className="detail-description">{place.description}{place.description.endsWith(".") ? "" : "."}</p> : <p className="detail-description muted">{preview ? "저장하면 둘만의 메모를 남길 수 있어요." : "아직 둘만의 메모는 없어요."}</p>}
    <div className="detail-facts">
      <div><span>추천 체류</span><b>{preview ? "저장 후 입력" : `${place.durationMinutes}분`}</b></div>
      <div><span>2인 예상</span><b>{preview ? "저장 후 입력" : formatPlaceCost(place.expectedCostTwo)}</b></div>
      <div><span>{place.phone ? "전화" : "영업시간"}</span><b>{place.phone || formatOpeningHours(place.openingHours)}</b></div>
    </div>
    {place.mapUrl && <a className="quiet-link" href={place.mapUrl} target="_blank" rel="noreferrer">{sourceLabel}</a>}
    {preview ? (
      <button className="primary-button full" type="button" onClick={onSave}>이 장소 저장</button>
    ) : (
      <div className="status-box"><span>YOU</span>{onStatusChange ? <div className="status-picker" role="group" aria-label="내 장소 상태">{STATUS_OPTIONS.map(status => <button type="button" className={`status-pill ${place.userStatus === status ? "is-active" : ""}`} key={status} onClick={() => onStatusChange(status)}>{STATUS_META[status].label}</button>)}</div> : <PlaceStatusBadge status={place.userStatus} />}<span>PARTNER</span><PlaceStatusBadge status={place.partnerStatus} /></div>
    )}
    <button className={preview ? "outline-button full" : "primary-button full"} type="button" onClick={onAdd}>여행 일정에 추가</button>
    {onAddDate && <button className="outline-button full" type="button" onClick={onAddDate}>데이트 일정에 추가</button>}
  </div>;
}
