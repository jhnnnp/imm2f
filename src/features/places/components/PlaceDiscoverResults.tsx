import { isDiscoverPlace } from "../discover";
import type { Place } from "../types/place";
import { PlaceCard } from "./PlaceCard";

export function PlaceDiscoverResults({
  places,
  selectedId,
  pending,
  error,
  isEnd,
  layout,
  emptyTitle,
  emptyBody,
  onSelect,
  onSave,
  onLoadMore,
  onManual,
  isSavePending,
}: {
  places: Place[];
  selectedId: string;
  pending: boolean;
  error: string;
  isEnd: boolean;
  layout: "grid" | "list";
  emptyTitle: string;
  emptyBody: string;
  onSelect: (id: string) => void;
  onSave: (place: Place) => void;
  onLoadMore?: () => void;
  onManual?: () => void;
  isSavePending?: (place: Place) => boolean;
}) {
  if (error) return <div className="empty-inline" role="alert"><h2>검색을 불러오지 못했어요.</h2><p>{error}</p></div>;
  if (pending && !places.length) return (
    <div className="discover-loading-panel" role="status" aria-live="polite" aria-label="장소 검색 중">
      <div className="discover-loading-copy"><i /><div><b>장소를 찾고 있어요</b><span>선택한 조건에 맞는 후보를 모으고 있어요.</span></div></div>
      <div className={layout === "list" ? "discover-skeleton-list" : "discover-skeleton-grid"} aria-hidden="true">
        {(layout === "list" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5]).map(item => (
          <span key={item}>{layout === "list" ? <><b /><small /></> : <><i /><b /><small /><small /></>}</span>
        ))}
      </div>
    </div>
  );
  if (!places.length) {
    return <div className="empty-inline">
      <h2>{emptyTitle}</h2>
      <p>{emptyBody}</p>
      {onManual && <button className="outline-button" type="button" onClick={onManual}>검색에 없으면 직접 입력</button>}
    </div>;
  }

  return (
    <div className="discover-results" aria-busy={pending}>
      {pending && (
        <div className="discover-refreshing" role="status" aria-live="polite">
          <i /><span><b>새 후보를 찾는 중</b> 현재 결과는 그대로 두고 업데이트할게요.</span>
        </div>
      )}
      <div className={pending ? "discover-result-content is-refreshing" : "discover-result-content"}>
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
        <div className="place-grid">{places.map(place => <PlaceCard key={place.id} place={place} selected={selectedId === place.id} onSelect={() => onSelect(place.id)} onToggleSave={() => onSave(place)} savePending={isSavePending?.(place) ?? false} />)}</div>
      )}
      </div>
      {onLoadMore && !isEnd && <div className="discover-more"><button className="outline-button" type="button" onClick={onLoadMore} disabled={pending}>{pending ? "불러오는 중..." : "더 보기"}</button></div>}
    </div>
  );
}
