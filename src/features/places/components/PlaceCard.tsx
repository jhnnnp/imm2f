import type { Place } from "../types/place";
import { PlaceStatusBadge } from "./PlaceStatusBadge";

export function PlaceCard({ place, selected, onSelect, onToggleSave }: { place: Place; selected: boolean; onSelect: () => void; onToggleSave: () => void }) {
  const saved = ["want", "must_visit", "revisit"].includes(place.userStatus);
  return <article className={`place-card ${selected ? "is-selected" : ""}`}>
    <button className={`place-image tone-${place.visualTone}`} onClick={onSelect} aria-label={`${place.name} 상세 보기`}>
      {place.image ? <img src={place.image} alt="" /> : <span className="abstract-photo large">{place.categoryLabel}<br />memory</span>}
      {place.userFit + place.partnerFit > 180 && <span className="match">BEST MATCH</span>}
    </button>
    <button className={`heart ${saved ? "is-on" : ""}`} onClick={onToggleSave} aria-label={saved ? "저장 취소" : "저장"}>{saved ? "♥" : "♡"}</button>
    <button className="place-info" onClick={onSelect}>
      <span>{place.categoryLabel} · {place.district}</span><h3>{place.name}</h3><p>{place.description}</p>
      <div className="couple-fit"><span>YOU <b>{place.userFit}</b></span><span>PARTNER <b>{place.partnerFit}</b></span><em><PlaceStatusBadge status={place.partnerStatus} /></em></div>
      <footer><b>{place.expectedCostTwo ? `2인 예상 ₩${place.expectedCostTwo.toLocaleString("ko-KR")}` : "무료"}</b><span>상세 보기 →</span></footer>
    </button>
  </article>;
}
