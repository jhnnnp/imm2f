"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { PLACE_MOODS, PLACE_AREA_GROUPS, areaGroupById, browseDiscoverInput } from "../config/regions";
import { searchDiscoverPlaces, loadTourPlaceDetail, updateMyPlaceStatus } from "../actions";
import { addPlaceToDraftDate, addPlaceToDraftTrip, getDraftDateItems, getDraftTripItems, setActiveTripDay } from "@/features/planning/draftTrip";
import { saveCouplePlan } from "@/features/planning/actions";
import { isDiscoverPlace, mergeCandidateWithSaved, placeToCandidate, uniqueByExternalId } from "../discover";
import type { DiscoverCandidate, Place, PlaceCategoryId, PlacePreferenceStatus } from "../types/place";
import { PlaceCard } from "./PlaceCard";
import { PlaceCreateDialog } from "./PlaceCreateDialog";
import { PlaceDetailPanel } from "./PlaceDetailPanel";
import { PlaceDiscoverResults } from "./PlaceDiscoverResults";
import { PlacesMapPane } from "./PlacesMapPane";
import { getDemoPlaces, saveDemoPlace, updateDemoPlaceStatus } from "../demoPlaces";
import { withObjectParticle } from "@/lib/korean";

type Section = "saved" | "search" | "browse" | "map";
type Filter = "all" | "want" | "visited" | "revisit";
type Layout = "grid" | "list";
type DialogMode = "confirm" | "manual";
const SAVED: PlacePreferenceStatus[] = ["want", "must_visit", "revisit"];
const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: "saved", label: "저장한 장소" },
  { id: "search", label: "장소 검색" },
  { id: "browse", label: "지역별 둘러보기" },
  { id: "map", label: "지도에서 찾기" },
];

export function PlacesExperience({ initialPlaces, persist, initialSelectedId }: { initialPlaces: Place[]; persist: boolean; initialSelectedId?: string }) {
  const searchParams = useSearchParams();
  const source = searchParams.get("from") === "date" ? "date" : searchParams.get("from") === "trip" ? "trip" : null;
  const selectedParam = searchParams.get("selected") ?? initialSelectedId ?? "";
  const [places, setPlaces] = useState<Place[]>(initialPlaces);
  const [section, setSection] = useState<Section>(source ? "search" : "saved");
  const [selectedId, setSelectedId] = useState(
    selectedParam && initialPlaces.some(place => place.id === selectedParam)
      ? selectedParam
      : initialPlaces[0]?.id ?? "",
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [savedCategory, setSavedCategory] = useState("all");
  const [savedQuery, setSavedQuery] = useState("");
  const [layout, setLayout] = useState<Layout>("grid");
  const [notice, setNotice] = useState("");
  const [noticeHref, setNoticeHref] = useState(source === "date" ? "/date" : "/trip");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("manual");
  const [pendingCandidate, setPendingCandidate] = useState<DiscoverCandidate | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState<PlaceCategoryId | "all">("all");
  const [browseGroup, setBrowseGroup] = useState("seoul");
  const [browseArea, setBrowseArea] = useState("");
  const [browseCategory, setBrowseCategory] = useState<PlaceCategoryId | "all">("cafe");
  const [browseMood, setBrowseMood] = useState("");
  const [mapCategory, setMapCategory] = useState<PlaceCategoryId | "all">("cafe");
  const [mapOrigin, setMapOrigin] = useState<{ x: number; y: number; radius: number } | null>(null);

  const [discover, setDiscover] = useState<Place[]>([]);
  const [discoverPage, setDiscoverPage] = useState(1);
  const [discoverIsEnd, setDiscoverIsEnd] = useState(true);
  const [discoverTotal, setDiscoverTotal] = useState(0);
  const [discoverPending, setDiscoverPending] = useState(false);
  const [discoverError, setDiscoverError] = useState("");
  const [discoverHint, setDiscoverHint] = useState("");
  const [searched, setSearched] = useState(false);
  const placesRef = useRef(places);
  placesRef.current = places;

  useEffect(() => {
    if (persist) return;
    setPlaces(getDemoPlaces());
  }, [persist]);

  useEffect(() => {
    if (source !== "trip") return;
    const day = Number(searchParams.get("day"));
    if (Number.isFinite(day)) setActiveTripDay(day);
  }, [searchParams, source]);

  useEffect(() => {
    if (!selectedParam) return;
    if (places.some(place => place.id === selectedParam) || discover.some(place => place.id === selectedParam)) {
      setSelectedId(selectedParam);
      setSection("saved");
    }
  }, [selectedParam, places, discover]);

  const counts = useMemo(() => ({
    all: places.length,
    want: places.filter(place => [place.userStatus, place.partnerStatus].some(value => value === "want" || value === "must_visit")).length,
    visited: places.filter(place => [place.userStatus, place.partnerStatus].includes("visited")).length,
    revisit: places.filter(place => [place.userStatus, place.partnerStatus].includes("revisit")).length,
  }), [places]);

  const visibleSaved = useMemo(() => places.filter(place => {
    const statuses: PlacePreferenceStatus[] = [place.userStatus, place.partnerStatus];
    const matchesStatus = filter === "all" || (filter === "want" && statuses.some(value => value === "want" || value === "must_visit")) || statuses.includes(filter);
    return matchesStatus && (savedCategory === "all" || place.category === savedCategory) && place.name.toLowerCase().includes(savedQuery.toLowerCase());
  }), [places, filter, savedCategory, savedQuery]);

  const selected = [...discover, ...places].find(place => place.id === selectedId) ?? (section === "saved" ? places[0] : discover[0]);

  const runDiscover = useCallback(async (input: Parameters<typeof searchDiscoverPlaces>[0], append = false) => {
    setDiscoverPending(true);
    setDiscoverError("");
    setDiscoverHint("");
    setSearched(true);
    const result = await searchDiscoverPlaces(input);
    setDiscoverPending(false);
    if (!result.ok) {
      if (!append) {
        setDiscover([]);
        setDiscoverTotal(0);
      }
      setDiscoverError(result.error);
      setDiscoverIsEnd(true);
      return;
    }
    const ranking = "ranking" in result ? result.ranking : undefined;
    const merged = result.places.map(item => {
      const row = ranking?.find(entry => entry.externalPlaceId === item.externalPlaceId && entry.externalSource === item.externalSource);
      return mergeCandidateWithSaved(item, placesRef.current, row ? { userFit: row.userFit, partnerFit: row.partnerFit, recommendReason: row.reason } : undefined);
    });
    setDiscover(previous => uniqueByExternalId(append ? [...previous, ...merged] : merged));
    setDiscoverPage(result.page);
    setDiscoverIsEnd(result.isEnd);
    setDiscoverTotal(result.totalCount);
    if (!result.places.length) setDiscoverHint("이 조건의 후보가 없어요. 지역이나 카테고리를 바꿔 보세요.");
    else if (ranking?.some(item => item.reason)) setDiscoverHint("저장한 취향을 기준으로 후보 순서를 맞췄어요.");
    if (!append && merged[0]) setSelectedId(merged[0].id);
  }, []);

  async function persistStatus(id: string, status: PlacePreferenceStatus) {
    setPlaces(current => current.map(place => place.id === id ? { ...place, userStatus: status } : place));
    if (!persist) {
      updateDemoPlaceStatus(id, status);
      return;
    }
    const result = await updateMyPlaceStatus(id, status);
    if ("error" in result) setNotice(result.error);
  }

  function toggleSave(id: string) {
    const place = places.find(item => item.id === id);
    if (!place) return;
    void persistStatus(id, SAVED.includes(place.userStatus) ? "neutral" : "want");
  }

  function openSave(place: Place) {
    if (!isDiscoverPlace(place)) {
      toggleSave(place.id);
      return;
    }
    const candidate = placeToCandidate(place);
    if (!candidate) return;
    setPendingCandidate(candidate);
    setDialogMode("confirm");
    setDialogOpen(true);
  }

  function openManual() {
    setPendingCandidate(null);
    setDialogMode("manual");
    setDialogOpen(true);
  }

  function handleSaved(place: Place, message: string) {
    if (!persist) saveDemoPlace(place);
    setPlaces(current => {
      const index = current.findIndex(item => item.id === place.id || (place.externalPlaceId && item.externalPlaceId === place.externalPlaceId));
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...current[index], ...place };
        return next;
      }
      return [...current, place];
    });
    setDiscover(current => current.map(item => (
      item.externalPlaceId && item.externalPlaceId === place.externalPlaceId ? place : item
    )));
    setSelectedId(place.id);
    setNotice(message);
    if (source) setNoticeHref(source === "date" ? "/date" : "/trip");
  }

  function handleSection(next: Section) {
    setSection(next);
    if (next === "map") setLayout("grid");
    if (next !== section) {
      setDiscover([]);
      setDiscoverError("");
      setDiscoverHint("");
      setSearched(false);
      setDiscoverTotal(0);
    }
  }

  async function handleSelect(id: string) {
    setSelectedId(id);
    const place = [...discover, ...places].find(item => item.id === id);
    if (!place || place.externalSource !== "tourapi" || !place.externalPlaceId) return;
    if (place.description && place.image) return;
    const detail = await loadTourPlaceDetail(place.externalPlaceId);
    if (!detail) return;
    setDiscover(current => current.map(item => (
      item.id === id
        ? { ...item, description: detail.overview || item.description, image: detail.image || item.image }
        : item
    )));
  }

  function addSelectedToPlan(kind: "trip" | "date") {
    if (!selected) return;
    const result = kind === "date" ? addPlaceToDraftDate(selected) : addPlaceToDraftTrip(selected);
    const label = kind === "date" ? "데이트 일정" : "여행 일정";
    setNoticeHref(kind === "date" ? "/date" : "/trip");
    setNotice(result.duplicate ? `${selected.name}은 이미 ${label}에 있어요.` : `${withObjectParticle(selected.name)} ${label}에 넣었어요.`);
    const items = kind === "date" ? getDraftDateItems() : getDraftTripItems();
    void saveCouplePlan(kind, items);
  }

  function handleSearch(formData?: FormData) {
    const nextQuery = formData ? String(formData.get("query") ?? "") : searchQuery;
    setSearchQuery(nextQuery);
    void runDiscover({ query: nextQuery, category: searchCategory, page: 1 });
  }

  function runBrowse(next: { group?: string; area?: string; category?: PlaceCategoryId | "all"; mood?: string }) {
    const group = next.group ?? browseGroup;
    const area = next.area ?? browseArea;
    const category = next.category ?? browseCategory;
    const mood = next.mood ?? browseMood;
    if (!group || !area) return;
    void runDiscover({ ...browseDiscoverInput(group, area), category, mood, page: 1 });
  }

  function handleLoadMore() {
    const nextPage = discoverPage + 1;
    if (section === "search") void runDiscover({ query: searchQuery, category: searchCategory, page: nextPage }, true);
    if (section === "browse") void runDiscover({ ...browseDiscoverInput(browseGroup, browseArea), category: browseCategory, mood: browseMood, page: nextPage }, true);
    if (section === "map" && mapOrigin) void runDiscover({ ...mapOrigin, category: mapCategory, page: nextPage }, true);
  }

  function handleMapSearch(origin: { x: number; y: number; radius: number }) {
    setMapOrigin(origin);
    void runDiscover({ ...origin, category: mapCategory === "all" ? "cafe" : mapCategory, page: 1 });
  }

  const selectedBrowseGroup = areaGroupById(browseGroup);

  const copy = {
    saved: { title: "둘의 장소", body: "저장한 장소만 여기에 모여 있어요." },
    search: { title: "장소 검색", body: "이름을 알면 찾아서 저장해요." },
    browse: { title: "지역별 둘러보기", body: "넓은 지역을 고른 뒤, 데이트하고 싶은 동네를 고르면 돼요." },
    map: { title: "지도에서 찾기", body: "지도를 옮긴 뒤, 지금 화면의 주변 장소를 가져와요." },
  }[section];

  return <AppShell context={selected ? <PlaceDetailPanel place={selected} preferredPlan={source} onAdd={() => addSelectedToPlan("trip")} onAddDate={() => addSelectedToPlan("date")} onStatusChange={status => void persistStatus(selected.id, status)} onSave={() => openSave(selected)} /> : undefined}>
    <div className="page-title-row">
      <div>
        <span className="eyebrow">OUR PLACE ARCHIVE</span>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
      </div>
      <div className="page-actions header-action-group">
        {section !== "saved" && <button className="date-action-button is-history" type="button" onClick={() => handleSection("saved")}><HeaderActionIcon name="archive" /><span>저장한 장소</span></button>}
        <button className="date-action-button is-history" type="button" onClick={openManual}><HeaderActionIcon name="edit" /><span>직접 입력</span></button>
        {section === "saved"
          ? <button className="date-action-button is-primary" type="button" onClick={() => handleSection("search")}><HeaderActionIcon name="search" /><span>장소 찾기</span></button>
          : null}
      </div>
    </div>

    <div className="toolbar">
      <div className="segmented" role="tablist" aria-label="장소 탐색">
        {SECTIONS.map(item => (
          <button className={section === item.id ? "is-active" : ""} onClick={() => handleSection(item.id)} key={item.id} type="button" role="tab" aria-selected={section === item.id}>
            {item.label}{item.id === "saved" ? <b>{counts.all}</b> : null}
          </button>
        ))}
      </div>
      <div className="view-options">
        <button className={layout === "grid" && section !== "map" ? "is-active" : ""} type="button" aria-label="그리드 보기" onClick={() => { setLayout("grid"); if (section === "map") setSection("search"); }}>▦</button>
        <button className={layout === "list" && section !== "map" ? "is-active" : ""} type="button" aria-label="목록 보기" onClick={() => { setLayout("list"); if (section === "map") setSection("search"); }}>☷</button>
        <button className={section === "map" ? "is-active" : ""} type="button" aria-label="지도 보기" onClick={() => handleSection("map")}>⌖</button>
      </div>
    </div>

    {section === "saved" && (
      <>
        <div className="segmented status-tabs" role="tablist" aria-label="장소 상태">
          {([["all", "전체", counts.all], ["want", "가고 싶어요", counts.want], ["visited", "가봤어요", counts.visited], ["revisit", "다시 갈래요", counts.revisit]] as const).map(([id, label, count]) => (
            <button className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)} key={id} type="button" role="tab" aria-selected={filter === id}>{label} <b>{count}</b></button>
          ))}
        </div>
        <div className="category-row">
          <button className={savedCategory === "all" ? "is-active" : ""} type="button" onClick={() => setSavedCategory("all")}>전체</button>
          {PLACE_CATEGORIES.map(item => <button className={savedCategory === item.id ? "is-active" : ""} type="button" onClick={() => setSavedCategory(item.id)} key={item.id}>{item.icon} {item.label}</button>)}
          <label><span>⌕</span><input id="place-archive-search" value={savedQuery} onChange={event => setSavedQuery(event.target.value)} placeholder="저장한 이름만 찾기" /></label>
        </div>
      </>
    )}

    {section === "search" && (
      <form className="discover-search" action={formData => void handleSearch(formData)}>
        <div className="discover-search-bar">
          <input
            name="query"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="성수 대림창고, 연남동 카페"
            aria-label="장소 이름 검색"
          />
          <button className="primary-button" type="submit" disabled={discoverPending}>{discoverPending ? "검색 중..." : "검색"}</button>
        </div>
        <div className="chip-row discover-cats">
          <button className={searchCategory === "all" ? "is-active" : ""} type="button" onClick={() => setSearchCategory("all")}>전체</button>
          {PLACE_CATEGORIES.map(item => <button className={searchCategory === item.id ? "is-active" : ""} type="button" onClick={() => setSearchCategory(item.id)} key={item.id}>{item.label}</button>)}
        </div>
      </form>
    )}

    {section === "browse" && (
      <div className="discover-browse">
        <div className="region-browser" aria-label="지역 선택">
          <div className="region-tabs" role="tablist" aria-label="넓은 지역">
            <button
              className={!browseGroup ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={!browseGroup}
              onClick={() => {
                setBrowseGroup("");
                setBrowseArea("");
                setDiscover([]);
                setDiscoverError("");
                setDiscoverHint("");
                setSearched(false);
                setDiscoverTotal(0);
              }}
            >
              전체
            </button>
            {PLACE_AREA_GROUPS.map(group => (
              <button
                className={browseGroup === group.id ? "is-active" : ""}
                type="button"
                key={group.id}
                role="tab"
                aria-selected={browseGroup === group.id}
                onClick={() => {
                  setBrowseGroup(group.id);
                  setBrowseArea("");
                  setDiscover([]);
                  setDiscoverError("");
                  setDiscoverHint("");
                  setSearched(false);
                  setDiscoverTotal(0);
                }}
              >
                {group.label}
              </button>
            ))}
          </div>
          <div className="region-options" role="listbox" aria-label="세부 지역">
            {selectedBrowseGroup ? (
              <>
                <button
                  className={browseArea === "all" ? "is-active" : ""}
                  type="button"
                  role="option"
                  aria-selected={browseArea === "all"}
                  onClick={() => {
                    setBrowseArea("all");
                    runBrowse({ group: selectedBrowseGroup.id, area: "all" });
                  }}
                >
                  {selectedBrowseGroup.label} 전체
                </button>
                {selectedBrowseGroup.areas.map(item => (
                  <button
                    className={browseArea === item.id ? "is-active" : ""}
                    type="button"
                    key={item.id}
                    role="option"
                    aria-selected={browseArea === item.id}
                    onClick={() => {
                      setBrowseArea(item.id);
                      runBrowse({ group: selectedBrowseGroup.id, area: item.id });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </>
            ) : (
              PLACE_AREA_GROUPS.map(group => (
                <button
                  type="button"
                  key={group.id}
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    setBrowseGroup(group.id);
                    setBrowseArea("all");
                    runBrowse({ group: group.id, area: "all" });
                  }}
                >
                  {group.label} 전체
                </button>
              ))
            )}
          </div>
        </div>
        <div className="discover-filter">
          <span>종류</span>
          <div className="chip-row">
            {PLACE_CATEGORIES.map(item => (
              <button className={browseCategory === item.id ? "is-active" : ""} type="button" key={item.id} onClick={() => {
                setBrowseCategory(item.id);
                runBrowse({ category: item.id });
              }}>{item.label}</button>
            ))}
          </div>
        </div>
        <div className="discover-filter is-mood">
          <span>분위기</span>
          <div className="chip-row">
            {PLACE_MOODS.map(item => (
              <button className={browseMood === item.query ? "is-active" : ""} type="button" key={item.id} onClick={() => {
                const next = browseMood === item.query ? "" : item.query;
                setBrowseMood(next);
                runBrowse({ mood: next });
              }}>{item.label}</button>
            ))}
          </div>
        </div>
      </div>
    )}

    {notice && <div className="inline-notice" role="status">{notice} <Link href={noticeHref}>{noticeHref === "/date" ? "데이트로 돌아가기" : "여행으로 돌아가기"}</Link><button type="button" onClick={() => setNotice("")} aria-label="알림 닫기">×</button></div>}

    {section === "saved" && (
      visibleSaved.length ? (
        layout === "list" ? (
          <ul className="place-result-list">
            {visibleSaved.map(place => (
              <li key={place.id}>
                <button type="button" className={`kakao-result ${selectedId === place.id ? "is-selected" : ""}`} onClick={() => setSelectedId(place.id)}>
                  <b>{place.name}</b>
                  <small>{place.categoryLabel} · {place.district}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="place-grid">{visibleSaved.map(place => <PlaceCard key={place.id} place={place} selected={selectedId === place.id} onSelect={() => setSelectedId(place.id)} onToggleSave={() => toggleSave(place.id)} />)}</div>
        )
      ) : (
        <div className="empty-soft">
          <h1>{places.length ? "조건에 맞는 장소가 없어요" : "첫 장소를 골라 볼까요?"}</h1>
          <p>{places.length ? "필터를 바꾸거나 다른 이름으로 찾아 보세요." : "이름을 검색하거나, 알고 있는 장소를 직접 남겨 보세요."}</p>
          <div className="dialog-actions">
            <button className="primary-button" type="button" onClick={() => handleSection("search")}>장소 찾기</button>
            <button className="outline-button" type="button" onClick={openManual}>직접 입력</button>
          </div>
        </div>
      )
    )}

    {section === "search" && (
      <PlaceDiscoverResults
        places={discover}
        selectedId={selectedId}
        pending={discoverPending}
        error={discoverError}
        hint={discoverHint}
        isEnd={discoverIsEnd}
        totalCount={discoverTotal}
        layout={layout}
        emptyTitle={searched ? "검색 결과가 없어요." : "장소 이름을 검색해 보세요."}
        emptyBody={searched ? "다른 이름이거나, 못 찾으면 직접 입력해 보세요." : "성수 대림창고처럼 알고 있는 이름을 넣으면 후보가 나와요."}
        onSelect={handleSelect}
        onSave={openSave}
        onLoadMore={!discoverIsEnd ? handleLoadMore : undefined}
        onManual={openManual}
      />
    )}

    {section === "browse" && (
      browseArea ? (
        <PlaceDiscoverResults
          places={discover}
          selectedId={selectedId}
          pending={discoverPending}
          error={discoverError}
          hint={discoverHint}
          isEnd={discoverIsEnd}
          totalCount={discoverTotal}
          layout={layout}
          emptyTitle="이 동네의 후보가 아직 없어요."
          emptyBody="다른 동네를 고르거나, 종류와 분위기를 바꿔 보세요."
          onSelect={handleSelect}
          onSave={openSave}
          onLoadMore={!discoverIsEnd ? handleLoadMore : undefined}
        />
      ) : (
        <div className="empty-inline">
          <h2>데이트할 동네를 골라 주세요.</h2>
          <p>홍대/합정, 강남/신사, 가평/양평처럼 가고 싶은 동네를 고르면 후보가 나와요.</p>
        </div>
      )
    )}

    {section === "map" && (
      <>
        <PlacesMapPane
          saved={places}
          results={discover}
          selectedId={selectedId}
          category={mapCategory}
          pending={discoverPending}
          onCategoryChange={setMapCategory}
          onSelect={handleSelect}
          onSearchHere={handleMapSearch}
        />
        {discoverError && <p className="form-error" role="alert">{discoverError}</p>}
        {discover.length > 0 && (
          <PlaceDiscoverResults
            places={discover}
            selectedId={selectedId}
            pending={discoverPending}
            error=""
            hint={discoverHint}
            isEnd={discoverIsEnd}
            totalCount={discoverTotal}
            layout="list"
            emptyTitle=""
            emptyBody=""
            onSelect={handleSelect}
            onSave={openSave}
            onLoadMore={!discoverIsEnd ? handleLoadMore : undefined}
          />
        )}
      </>
    )}

    <PlaceCreateDialog
      open={dialogOpen}
      mode={dialogMode}
      persist={persist}
      candidate={pendingCandidate}
      savedKakaoIds={places.map(place => place.externalPlaceId ? `${place.externalSource ?? "kakao"}:${place.externalPlaceId}` : "").filter(Boolean)}
      onClose={() => setDialogOpen(false)}
      onSaved={handleSaved}
    />
  </AppShell>;
}
