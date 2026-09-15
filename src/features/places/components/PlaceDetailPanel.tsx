import type { Place } from "../types/place";
import { PlaceStatusBadge } from "./PlaceStatusBadge";

export function PlaceDetailPanel({ place, onAdd }: { place: Place; onAdd: () => void }) {
  return <div className="place-detail-panel">
    <div className={`detail-photo tone-${place.visualTone}`}>{place.image ? <img src={place.image} alt={place.name} /> : <div className="abstract-photo large">{place.categoryLabel}<br />memory</div>}<span>{place.categoryLabel.toUpperCase()} · GUNSAN</span></div>
    <div className="place-detail-head"><div><span className="eyebrow">PLACE NOTE</span><h2>{place.name}</h2><p>전북 {place.district}</p></div><button className="detail-heart" aria-label="저장됨">♥</button></div>
    <p className="detail-description">{place.description}.</p>
    <div className="detail-facts"><div><span>추천 체류</span><b>{place.durationMinutes}분</b></div><div><span>2인 예상</span><b>{place.expectedCostTwo ? `₩${place.expectedCostTwo.toLocaleString("ko-KR")}` : "무료"}</b></div></div>
    <div className="status-box"><span>YOU</span><PlaceStatusBadge status={place.userStatus} /><span>PARTNER</span><PlaceStatusBadge status={place.partnerStatus} /></div>
    <button className="primary-button full" onClick={onAdd}>군산 여행 일정에 추가</button>
  </div>;
}
