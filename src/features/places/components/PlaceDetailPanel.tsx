import type { Place, PlacePreferenceStatus } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { STATUS_META } from "../config/statusMeta";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { kakaoPlaceUrl, naverPlaceSearchUrl } from "../format";
import { PlaceGraphicCover } from "./PlaceGraphicCover";
import { PlaceLocationMap } from "./PlaceLocationMap";

const STATUS_OPTIONS: PlacePreferenceStatus[] = ["want", "visited", "revisit", "not_interested"];

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
  const kakaoUrl = place.externalSource === "kakao" && place.mapUrl
    ? place.mapUrl
    : kakaoPlaceUrl(place.name, place.coordinates);
  return <div className="place-detail-panel">
    <div className={`detail-photo tone-${place.visualTone} ${place.image ? "" : "is-empty"}`}>{place.image ? <img src={place.image} alt={place.name} /> : <PlaceGraphicCover place={place} />}<span>{place.categoryLabel.toUpperCase()} · {preview ? "CANDIDATE" : "PLACE"}</span></div>
    <div className="place-detail-head"><div><span className="eyebrow">{preview ? "PLACE PREVIEW" : "PLACE NOTE"}</span><h2>{place.name}</h2><p>{address}</p></div>{!preview && <button className="detail-heart is-on" type="button" aria-label="가고 싶어요 해제" onClick={() => onSave?.()}>♥</button>}</div>
    {place.recommendReason ? <p className="detail-description">{place.recommendReason}</p> : place.description ? <p className="detail-description">{place.description}{place.description.endsWith(".") ? "" : "."}</p> : <p className="detail-description muted">{preview ? "저장하면 둘만의 메모를 남길 수 있어요." : "아직 둘만의 메모는 없어요."}</p>}
    {place.coordinates && <PlaceLocationMap name={place.name} coordinates={place.coordinates} />}
    {preview && (place.detailedCategory || place.openingHours || place.detailFacts?.length) && <dl className="place-api-facts">
      {place.detailedCategory && <div><dt>분류</dt><dd>{place.detailedCategory.split(">").map(item => item.trim()).filter(Boolean).slice(-2).join(" · ")}</dd></div>}
      {place.openingHours && <div><dt>이용시간</dt><dd>{place.openingHours}</dd></div>}
      {place.detailFacts?.map(fact => <div key={`${fact.label}-${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>}
    <div className="external-place-links">
      <span className="external-place-links-label">지도 앱으로 열기</span>
      <div className="map-app-grid">
        <a className="map-app-link is-kakao" href={kakaoUrl} target="_blank" rel="noreferrer" aria-label="카카오맵에서 장소 보기">
          <span className="map-service-lockup"><b className="kakao-wordmark">kakao map</b><small>지도에서 보기</small></span><em aria-hidden="true">↗</em>
        </a>
        <a className="map-app-link is-naver" href={naverPlaceSearchUrl(place.name, address)} target="_blank" rel="noreferrer" aria-label="네이버 지도에서 장소 보기">
          <span className="map-service-lockup"><b className="naver-wordmark">NAVER</b><small>지도에서 보기</small></span><em aria-hidden="true">↗</em>
        </a>
      </div>
      {place.externalSource === "tourapi" && place.mapUrl && <a className="place-source-link" href={place.mapUrl} target="_blank" rel="noreferrer">대한민국 구석구석 상세정보 <span>↗</span></a>}
      {place.homepage && <a className="place-source-link" href={place.homepage} target="_blank" rel="noreferrer">공식 홈페이지 <span>↗</span></a>}
    </div>
    {preview ? (
      <button className={preferredPlan ? "outline-button full" : "primary-button full"} type="button" onClick={onSave}>나중을 위해 저장</button>
    ) : (
      <div className="status-box"><span>내 마음</span>{onStatusChange ? <div className="status-picker" role="group" aria-label="이 장소에 대한 내 마음">{STATUS_OPTIONS.map(status => <button type="button" className={`status-pill ${place.userStatus === status ? "is-active" : ""}`} key={status} onClick={() => onStatusChange(status)}>{STATUS_META[status].label}</button>)}</div> : <PlaceStatusBadge status={place.userStatus} />}<span>파트너</span><PlaceStatusBadge status={place.partnerStatus} /></div>
    )}
    {preferredPlan === "date" && onAddDate && <button className="primary-button full" type="button" onClick={onAddDate}>이 데이트에 추가</button>}
    {preferredPlan === "trip" && <button className="primary-button full" type="button" onClick={onAdd}>선택한 날에 추가</button>}
    {preferredPlan !== "trip" && <button className="outline-button full" type="button" onClick={onAdd}>여행 일정에 추가</button>}
    {preferredPlan !== "date" && onAddDate && <button className="outline-button full" type="button" onClick={onAddDate}>데이트 일정에 추가</button>}
  </div>;
}
