import type { Place } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { formatPlaceCostShort } from "../format";

export function PlaceCard({
  place,
  selected,
  onSelect,
  onToggleSave,
}: {
  place: Place;
  selected: boolean;
  onSelect: () => void;
  onToggleSave: () => void;
}) {
  const discover = isDiscoverPlace(place);
  const saved = ["want", "must_visit", "revisit"].includes(place.userStatus);
  return <article className={`place-card ${selected ? "is-selected" : ""}`}>
    <button className={`place-image tone-${place.visualTone}`} onClick={onSelect} aria-label={`${place.name} ${discover ? "미리보기" : "상세 보기"}`}>
      {place.image ? <img src={place.image} alt="" /> : <span className="abstract-photo large">{place.categoryLabel}<br />{discover ? "preview" : "memory"}</span>}
      {place.userFit + place.partnerFit > 180 && <span className="match">BEST MATCH</span>}
      {discover && <span className="match soft">둘러보기</span>}
    </button>
    <button className={`heart ${saved ? "is-on" : ""}`} onClick={onToggleSave} aria-label={saved ? "저장됨" : "이 장소 저장"}>{saved ? "♥" : "♡"}</button>
    <button className="place-info" onClick={onSelect}>
      <span>{place.categoryLabel} · {place.district}</span><h3>{place.name}</h3><p>{place.recommendReason || place.description || place.roadAddress || place.address || place.district}</p>
      {discover
        ? <div className="couple-fit"><span>YOU <b>{place.userFit}</b></span><span>PARTNER <b>{place.partnerFit}</b></span><em>{place.externalSource === "tourapi" ? "TourAPI" : "카카오"}{saved ? " · 저장됨" : ""}</em></div>
        : <div className="couple-fit"><span>YOU <b>{place.userFit}</b></span><span>PARTNER <b>{place.partnerFit}</b></span><em><PlaceStatusBadge status={place.partnerStatus} /></em></div>}
      <footer><b>{discover ? (place.roadAddress || place.address || "주소 확인") : formatPlaceCostShort(place.expectedCostTwo)}</b><span>{discover ? "미리보기 →" : "상세 보기 →"}</span></footer>
    </button>
  </article>;
}
