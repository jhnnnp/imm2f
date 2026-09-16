import { isDiscoverPlace } from "../discover";
import type { Place } from "../types/place";
import { PlaceCard } from "./PlaceCard";

export function PlaceDiscoverResults({
  places,
  selectedId,
  pending,
  error,
  hint,
  isEnd,
  totalCount,
  layout,
  emptyTitle,
  emptyBody,
  onSelect,
  onSave,
  onLoadMore,
  onManual,
}: {
  places: Place[];
  selectedId: string;
  pending: boolean;
  error: string;
  hint: string;
  isEnd: boolean;
  totalCount: number;
  layout: "grid" | "list";
  emptyTitle: string;
  emptyBody: string;
  onSelect: (id: string) => void;
  onSave: (place: Place) => void;
  onLoadMore?: () => void;
  onManual?: () => void;
}) {
  if (error) return <div className="empty-inline" role="alert"><h2>검색을 불러오지 못했어요.</h2><p>{error}</p></div>;
  if (pending && !places.length) return <div className="empty-inline"><h2>장소를 찾고 있어요.</h2><p>이 조건에 맞는 후보를 모으고 있어요.</p></div>;
  if (!places.length) {
    return <div className="empty-inline">
      <h2>{emptyTitle}</h2>
      <p>{emptyBody}</p>
      {onManual && <button className="outline-button" type="button" onClick={onManual}>검색에 없으면 직접 입력</button>}
    </div>;
  }

  return (
    <div className="discover-results">
      <p className="discover-count">{totalCount ? `${totalCount}곳 중 ${places.length}곳을 보고 있어요.` : `${places.length}곳을 둘러보는 중이에요.`} 저장한 장소는 함께 표시돼요.</p>
      {hint && <p className="form-hint">{hint}</p>}
      {layout === "list" ? (
        <ul className="place-result-list">
          {places.map(place => (
            <li key={place.id}>
              <button type="button" className={`kakao-result ${selectedId === place.id ? "is-selected" : ""}`} onClick={() => onSelect(place.id)}>
                <b>{place.name}</b>
                <small>{place.categoryLabel} · {place.roadAddress || place.address || place.district}</small>
                {place.externalPlaceId && !isDiscoverPlace(place) && <em>이미 저장됨</em>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="place-grid">{places.map(place => <PlaceCard key={place.id} place={place} selected={selectedId === place.id} onSelect={() => onSelect(place.id)} onToggleSave={() => onSave(place)} />)}</div>
      )}
      {onLoadMore && !isEnd && <div className="discover-more"><button className="outline-button" type="button" onClick={onLoadMore} disabled={pending}>{pending ? "불러오는 중..." : "더 보기"}</button></div>}
    </div>
  );
}
