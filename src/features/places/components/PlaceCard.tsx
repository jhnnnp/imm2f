import type { Place } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { PlaceGraphicCover } from "./PlaceGraphicCover";
import { PlaceTripStamp } from "./PlaceTripStampIcon";

export function PlaceCard({
  place,
  selected,
  onSelect,
  onToggleSave,
  onTripSchedule = false,
}: {
  place: Place;
  selected: boolean;
  onSelect: () => void;
  onToggleSave: () => void;
  onTripSchedule?: boolean;
}) {
  const discover = isDiscoverPlace(place);
  const saved = ["want", "must_visit", "revisit"].includes(place.userStatus);
  return <article className={`place-card ${selected ? "is-selected" : ""}`}>
    <button className={`place-image tone-${place.visualTone} ${place.image ? "" : "is-empty"}`} onClick={onSelect} aria-label={`${place.name} ${discover ? "미리보기" : "상세 보기"}`}>
      {place.image ? <img src={place.image} alt="" /> : <PlaceGraphicCover place={place} />}
      {place.userFit + place.partnerFit > 180 && <span className="match">BEST MATCH</span>}
      {onTripSchedule && !discover ? <PlaceTripStamp /> : null}
      {discover && <span className="match soft">둘러보기</span>}
    </button>
    <button className={`heart ${saved ? "is-on" : ""}`} onClick={onToggleSave} aria-label={saved ? "저장됨" : "이 장소 저장"}>{saved ? "♥" : "♡"}</button>
    <button className="place-info" onClick={onSelect}>
      <span>{place.categoryLabel} · {place.district}{place.category === "festival" && place.openingHours ? ` · ${place.openingHours}` : ""}</span><h3>{place.name}</h3><p>{place.recommendReason || place.description || place.roadAddress || place.address || place.district}</p>
      {discover
        ? <div className="couple-fit" aria-label="두 사람의 취향 예상 점수"><span>나 <b>{place.userFit}</b></span><span>파트너 <b>{place.partnerFit}</b></span><em>{saved ? "저장됨" : "후보"}</em></div>
        : <div className="couple-fit"><span>나 <b>{place.userFit}</b></span><span>파트너 <b>{place.partnerFit}</b></span><em><PlaceStatusBadge status={place.partnerStatus} /></em></div>}
      <footer><b>{place.roadAddress || place.address || place.district}</b><span>{discover ? "미리보기 →" : "상세 보기 →"}</span></footer>
    </button>
  </article>;
}
