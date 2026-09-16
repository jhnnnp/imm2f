import type { Place, PlacePreferenceStatus } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { STATUS_META } from "../config/statusMeta";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { formatOpeningHours, formatPlaceCost, formatStayMinutes, naverPlaceSearchUrl } from "../format";
import { PlaceGraphicCover } from "./PlaceGraphicCover";

const STATUS_OPTIONS: PlacePreferenceStatus[] = ["visited", "want", "must_visit", "revisit", "neutral", "dislike", "not_interested"];

export function PlaceDetailPanel({
  place,
  onAdd,
  onAddDate,
  onStatusChange,
  onSave,
  preferredPlan,
}: {
  place: Place;
  onAdd: () => void;
  onAddDate?: () => void;
  onStatusChange?: (status: PlacePreferenceStatus) => void;
  onSave?: () => void;
  preferredPlan?: "trip" | "date" | null;
}) {
  const preview = isDiscoverPlace(place);
  const address = place.roadAddress || place.address || place.district;
  const sourceLabel = place.externalSource === "tourapi" ? "대한민국 구석구석에서 보기" : "카카오맵에서 보기";
  return <div className="place-detail-panel">
    <div className={`detail-photo tone-${place.visualTone} ${place.image ? "" : "is-empty"}`}>{place.image ? <img src={place.image} alt={place.name} /> : <PlaceGraphicCover place={place} />}<span>{place.categoryLabel.toUpperCase()} · {preview ? "CANDIDATE" : "PLACE"}</span></div>
    <div className="place-detail-head"><div><span className="eyebrow">{preview ? "PLACE PREVIEW" : "PLACE NOTE"}</span><h2>{place.name}</h2><p>{address}</p></div>{!preview && <button className="detail-heart is-on" type="button" aria-label="가고 싶어요 해제" onClick={() => onSave?.()}>♥</button>}</div>
    {place.recommendReason ? <p className="detail-description">{place.recommendReason}</p> : place.description ? <p className="detail-description">{place.description}{place.description.endsWith(".") ? "" : "."}</p> : <p className="detail-description muted">{preview ? "저장하면 둘만의 메모를 남길 수 있어요." : "아직 둘만의 메모는 없어요."}</p>}
    <div className="detail-facts">
      <div><span>예상 시간</span><b>{preview ? "저장 후 입력" : formatStayMinutes(place.durationMinutes)}</b></div>
      <div><span>예상 금액</span><b>{preview ? "저장 후 입력" : formatPlaceCost(place.expectedCostTwo)}</b></div>
      <div><span>{place.phone ? "전화" : "영업시간"}</span><b>{place.phone || formatOpeningHours(place.openingHours)}</b></div>
    </div>
    <div className="external-place-links">
      {place.mapUrl && <a className="quiet-link" href={place.mapUrl} target="_blank" rel="noreferrer">{sourceLabel} ↗</a>}
      <a className="quiet-link naver-link" href={naverPlaceSearchUrl(place.name, address)} target="_blank" rel="noreferrer">네이버 지도에서 보기 ↗</a>
    </div>
    {preview ? (
      <button className={preferredPlan ? "outline-button full" : "primary-button full"} type="button" onClick={onSave}>나중을 위해 저장</button>
    ) : (
      <div className="status-box"><span>나</span>{onStatusChange ? <div className="status-picker" role="group" aria-label="내 장소 상태">{STATUS_OPTIONS.map(status => <button type="button" className={`status-pill ${place.userStatus === status ? "is-active" : ""}`} key={status} onClick={() => onStatusChange(status)}>{STATUS_META[status].label}</button>)}</div> : <PlaceStatusBadge status={place.userStatus} />}<span>파트너</span><PlaceStatusBadge status={place.partnerStatus} /></div>
    )}
    {preferredPlan === "date" && onAddDate && <button className="primary-button full" type="button" onClick={onAddDate}>이 데이트에 추가</button>}
    {preferredPlan === "trip" && <button className="primary-button full" type="button" onClick={onAdd}>선택한 날에 추가</button>}
    {preferredPlan !== "trip" && <button className="outline-button full" type="button" onClick={onAdd}>여행 일정에 추가</button>}
    {preferredPlan !== "date" && onAddDate && <button className="outline-button full" type="button" onClick={onAddDate}>데이트 일정에 추가</button>}
  </div>;
}
