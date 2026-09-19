"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { PLACE_ADMINISTRATIVE_AREAS, PLACE_AREA_GROUPS, areaGroupById, browseDiscoverInput } from "../config/regions";
import { listPlaces, searchDiscoverPlaces, loadTourPlaceDetail, lookupPlaceLocation, updateMyPlaceStatus, updatePlaceDescription, updatePlaceLocation } from "../actions";
import { applyPlaceLocation } from "../location";
import { addItemToCouplePlan } from "@/features/planning/actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { isDiscoverPlace, mergeCandidateWithSaved, placeToCandidate, uniqueByExternalId } from "../discover";
import type { DiscoverCandidate, Place, PlaceCategoryId, PlacePreferenceStatus } from "../types/place";
import { PlaceCard } from "./PlaceCard";
import { PlaceCreateDialog } from "./PlaceCreateDialog";
import { PlaceDetailPanel } from "./PlaceDetailPanel";
import { PlaceDiscoverResults } from "./PlaceDiscoverResults";
import { PlaceCategoryIcon } from "./PlaceCategoryIcon";
import { PlaceTripFilterIcon } from "./PlaceTripFilterIcon";
import { PlaceTripStamp } from "./PlaceTripStampIcon";
import { placeIsOnAnyTrip, tripScheduleStopsForPlace } from "../tripPlaceMatch";
import type { ArchivedTripPlan } from "@/features/planning/actions";
import type { PlanItem } from "@/features/planning/types/plan";
import dynamic from "next/dynamic";

const PlacesMapPane = dynamic(
  () => import("./PlacesMapPane").then(mod => mod.PlacesMapPane),
  {
    ssr: false,
    loading: () => <div className="places-map-wrap page-loading" aria-busy="true"><div className="page-loading-title" /><div className="page-loading-copy" /></div>,
  },
);
import { withObjectParticle } from "@/lib/korean";

type Section = "saved" | "search" | "browse" | "map";
type Filter = "all" | "want" | "visited" | "revisit" | "not_interested" | "trip";
type Layout = "grid" | "list";
type DialogMode = "confirm" | "manual";
type SavedCategoryFilter = "all" | PlaceCategoryId;
const SAVED: PlacePreferenceStatus[] = ["want", "must_visit", "revisit"];

function isKeptInArchive(place: Place) {
  return place.userStatus !== "neutral" || place.partnerStatus !== "neutral";
}

const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: "saved", label: "저장한 장소" },
  { id: "search", label: "장소 검색" },
  { id: "browse", label: "지역별 둘러보기" },
  { id: "map", label: "지도에서 찾기" },
];

export function PlacesExperience({
  initialPlaces,
  persist,
  initialSelectedId,
  initialTripItems = [],
  tripPlanTitle = "",
  initialArchivedTrips = [],
}: {
  initialPlaces: Place[];
  persist: boolean;
  initialSelectedId?: string;
  initialTripItems?: PlanItem[];
  tripPlanTitle?: string;
  initialArchivedTrips?: ArchivedTripPlan[];
}) {
  const searchParams = useSearchParams();
  const source = searchParams.get("from") === "date" ? "date" : searchParams.get("from") === "trip" ? "trip" : null;
  const selectedParam = searchParams.get("selected") ?? initialSelectedId ?? "";
  const [places, setPlaces] = useState<Place[]>(initialPlaces);
  const [section, setSection] = useState<Section>(source ? "search" : "saved");
  const [selectedId, setSelectedId] = useState(
    selectedParam && initialPlaces.some(place => place.id === selectedParam)
      ? selectedParam
      : initialPlaces.find(isKeptInArchive)?.id ?? "",
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [savedCategory, setSavedCategory] = useState<SavedCategoryFilter>("all");
  const [tripItems, setTripItems] = useState<PlanItem[]>(initialTripItems);
  const [archivedTrips] = useState<ArchivedTripPlan[]>(initialArchivedTrips);
  const [savedQuery, setSavedQuery] = useState("");
  const [layout, setLayout] = useState<Layout>("grid");
  const [notice, setNotice] = useState("");
  const [noticeHref, setNoticeHref] = useState(source === "date" ? "/date" : "/trip");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("manual");
  const [pendingCandidate, setPendingCandidate] = useState<DiscoverCandidate | null>(null);
  const [pendingInitialDescription, setPendingInitialDescription] = useState("");
  const [planPending, setPlanPending] = useState<"trip" | "date" | null>(null);
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState<PlaceCategoryId | "all">("all");
  const [browseGroup, setBrowseGroup] = useState("seoul");
  const [browseArea, setBrowseArea] = useState("all");
  const [browseCategories, setBrowseCategories] = useState<PlaceCategoryId[]>([]);
  const [browseRegionQuery, setBrowseRegionQuery] = useState("");
  const [browseResultQuery, setBrowseResultQuery] = useState("");
  const [regionSuggestionsOpen, setRegionSuggestionsOpen] = useState(false);
  const [mapCategory, setMapCategory] = useState<PlaceCategoryId | "all">("cafe");
  const [mapOrigin, setMapOrigin] = useState<{ x: number; y: number; radius: number } | null>(null);

  const [discover, setDiscover] = useState<Place[]>([]);
  const [discoverPage, setDiscoverPage] = useState(1);
  const [discoverIsEnd, setDiscoverIsEnd] = useState(true);
  const [discoverPending, setDiscoverPending] = useState(false);
  const [discoverError, setDiscoverError] = useState("");
  const [searched, setSearched] = useState(false);
  const placesRef = useRef(places);
  const discoverRequestRef = useRef(0);
  const regionSearchRef = useRef<HTMLDivElement>(null);
  placesRef.current = places;
  useSharedRefresh(async () => {
    const before = placesRef.current;
    const result = await listPlaces();
    if (before === placesRef.current && result.persist) setPlaces(result.places);
  });

  useEffect(() => {
    if (!selectedParam) return;
    if (places.some(place => place.id === selectedParam) || discover.some(place => place.id === selectedParam)) {
      setSelectedId(selectedParam);
      setSection("saved");
    }
  }, [selectedParam, places, discover]);

  useEffect(() => {
    if (!regionSuggestionsOpen) return;
    const closeSuggestions = (event: MouseEvent) => {
      if (!regionSearchRef.current?.contains(event.target as Node)) setRegionSuggestionsOpen(false);
    };
    document.addEventListener("mousedown", closeSuggestions);
    return () => document.removeEventListener("mousedown", closeSuggestions);
  }, [regionSuggestionsOpen]);

  const archivedPlaces = useMemo(() => places.filter(isKeptInArchive), [places]);

  const counts = useMemo(() => ({
    all: archivedPlaces.length,
    want: archivedPlaces.filter(place => [place.userStatus, place.partnerStatus].some(value => value === "want" || value === "must_visit")).length,
    visited: archivedPlaces.filter(place => [place.userStatus, place.partnerStatus].includes("visited")).length,
    revisit: archivedPlaces.filter(place => [place.userStatus, place.partnerStatus].includes("revisit")).length,
    notInterested: archivedPlaces.filter(place => [place.userStatus, place.partnerStatus].some(value => value === "not_interested" || value === "dislike")).length,
  }), [archivedPlaces]);

  const tripPlaceCount = useMemo(
    () => archivedPlaces.filter(place => placeIsOnAnyTrip(tripItems, archivedTrips, place)).length,
    [archivedPlaces, tripItems, archivedTrips],
  );

  const tripLinkedPlaceIds = useMemo(
    () => new Set(archivedPlaces.filter(place => placeIsOnAnyTrip(tripItems, archivedTrips, place)).map(place => place.id)),
    [archivedPlaces, tripItems, archivedTrips],
  );

  const visibleSaved = useMemo(() => archivedPlaces.filter(place => {
    const statuses: PlacePreferenceStatus[] = [place.userStatus, place.partnerStatus];
    const matchesStatus = filter === "trip"
      ? placeIsOnAnyTrip(tripItems, archivedTrips, place)
      : filter === "all"
        || (filter === "want" && statuses.some(value => value === "want" || value === "must_visit"))
        || (filter === "not_interested" && statuses.some(value => value === "not_interested" || value === "dislike"))
        || statuses.includes(filter);
    const matchesCategory = savedCategory === "all" || place.category === savedCategory;
    return matchesStatus && matchesCategory && place.name.toLowerCase().includes(savedQuery.toLowerCase());
  }), [archivedPlaces, filter, savedCategory, savedQuery, tripItems, archivedTrips]);

  const selected = (section === "saved" ? archivedPlaces : [...discover, ...places]).find(place => place.id === selectedId)
    ?? (section === "saved" ? visibleSaved[0] : discover[0]);

  const selectedTripStops = useMemo(
    () => (selected ? tripScheduleStopsForPlace(tripItems, tripPlanTitle, archivedTrips, selected) : []),
    [selected, tripItems, tripPlanTitle, archivedTrips],
  );

  const runDiscover = useCallback(async (input: Parameters<typeof searchDiscoverPlaces>[0], append = false) => {
    const requestId = ++discoverRequestRef.current;
    flushSync(() => {
      setDiscoverPending(true);
      setDiscoverError("");
      setSearched(true);
      if (!append) {
        setDiscover([]);
        setDiscoverIsEnd(false);
        setDiscoverPage(1);
      }
    });
    try {
      const result = await searchDiscoverPlaces(input);
      if (requestId !== discoverRequestRef.current) return;
      if (!result.ok) {
        if (!append) {
          setDiscover([]);
        }
        setDiscoverError(result.error);
        setDiscoverIsEnd(true);
        return;
      }
      const merged = result.places.map(item => mergeCandidateWithSaved(item, placesRef.current));
      setDiscover(previous => uniqueByExternalId(append ? [...previous, ...merged] : merged));
      setDiscoverPage(result.page);
      setDiscoverIsEnd(result.isEnd);
      if (!append && merged[0]) setSelectedId(merged[0].id);
    } finally {
      if (requestId === discoverRequestRef.current) {
        setDiscoverPending(false);
      }
    }
  }, []);

  async function persistStatus(id: string, status: PlacePreferenceStatus) {
    if (statusPendingId) return;
    const previous = places.find(place => place.id === id) ?? discover.find(place => place.id === id);
    const applyStatus = (current: Place[]) => current.map(place => place.id === id ? { ...place, userStatus: status } : place);
    setStatusPendingId(id);
    if (!persist) {
      setNotice("로그인과 데이터베이스 연결이 필요해요.");
      setStatusPendingId(null);
      return;
    }
    const [result] = await Promise.all([
      updateMyPlaceStatus(id, status),
      new Promise(resolve => window.setTimeout(resolve, 450)),
    ]);
    if (!("error" in result)) {
      const nextPlaces = applyStatus(places);
      const updated = nextPlaces.find(place => place.id === id);
      setPlaces(nextPlaces);
      setDiscover(applyStatus);
      if (updated && !isKeptInArchive(updated)) {
        setSelectedId(nextPlaces.find(place => place.id !== id && isKeptInArchive(place))?.id ?? "");
      }
      emitCoupleActivitiesChanged();
      setStatusPendingId(null);
      return;
    }
    setNotice(result.error);
    if (previous) setSelectedId(id);
    setStatusPendingId(null);
  }

  function toggleSave(id: string) {
    const place = places.find(item => item.id === id) ?? discover.find(item => item.id === id);
    if (!place) return;
    void persistStatus(id, SAVED.includes(place.userStatus) ? "neutral" : "want");
  }

  function isSavePending(place: Place) {
    if (statusPendingId === place.id) return true;
    if (!dialogPending || !pendingCandidate) return false;
    return Boolean(
      place.externalPlaceId
      && place.externalPlaceId === pendingCandidate.externalPlaceId
      && place.externalSource === pendingCandidate.externalSource,
    );
  }

  function closePlaceDialog() {
    setDialogOpen(false);
    setPendingCandidate(null);
    setPendingInitialDescription("");
    setDialogPending(false);
  }

  function memoSeedForSaveDialog(place: Place) {
    if (isDiscoverPlace(place)) return "";
    const memo = place.description?.trim() ?? "";
    if (memo && place.recommendReason && memo === place.recommendReason.trim()) return "";
    return memo;
  }

  function openSave(place: Place) {
    if (SAVED.includes(place.userStatus)) {
      toggleSave(place.id);
      return;
    }

    const candidate = placeToCandidate(place);
    if (candidate) {
      const samePending = dialogOpen
        && dialogMode === "confirm"
        && pendingCandidate?.externalPlaceId === candidate.externalPlaceId
        && pendingCandidate?.externalSource === candidate.externalSource;
      if (samePending) {
        closePlaceDialog();
        return;
      }
      setPendingCandidate(candidate);
      setPendingInitialDescription(memoSeedForSaveDialog(place));
      setDialogMode("confirm");
      setDialogOpen(true);
      return;
    }

    toggleSave(place.id);
  }

  function openManual() {
    setPendingCandidate(null);
    setDialogMode("manual");
    setDialogOpen(true);
  }

  function handleSaved(place: Place, message: string) {
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

  function applyPlace(place: Place) {
    const same = (item: Place) => item.id === place.id || Boolean(place.externalPlaceId && item.externalPlaceId === place.externalPlaceId && item.externalSource === place.externalSource);
    setPlaces(current => current.map(item => same(item) ? { ...item, ...place } : item));
    setDiscover(current => current.map(item => same(item) ? { ...item, ...place } : item));
  }

  async function handleLocationSave(input: { address: string; district: string }) {
    if (!selected) return { error: "장소를 먼저 골라 주세요." };
    if (isDiscoverPlace(selected)) {
      const result = await lookupPlaceLocation(selected.name, input);
      if ("error" in result) return result;
      applyPlace(applyPlaceLocation(selected, result.location));
      return;
    }
    if (!persist) return { error: "로그인 후 위치를 수정할 수 있어요." };
    const result = await updatePlaceLocation(selected.id, input);
    if ("error" in result) return result;
    applyPlace(result.place);
  }

  async function handleDescriptionSave(description: string) {
    if (!selected) return { error: "장소를 먼저 골라 주세요." };
    if (isDiscoverPlace(selected)) return { error: "저장한 뒤 메모를 남길 수 있어요." };
    if (!persist) return { error: "로그인 후 메모를 수정할 수 있어요." };
    const result = await updatePlaceDescription(selected.id, description);
    if ("error" in result) return result;
    applyPlace(result.place);
  }

  function handleSection(next: Section) {
    setSection(next);
    if (next === "map") setLayout("grid");
    if (next !== section) {
      setDiscover([]);
      setDiscoverError("");
      setSearched(false);
    }
  }

  async function handleSelect(id: string) {
    setSelectedId(id);
    const place = [...discover, ...places].find(item => item.id === id);
    if (!place || place.externalSource !== "tourapi" || !place.externalPlaceId) return;
    if (place.tourDetailLoaded) return;
    const detail = await loadTourPlaceDetail(place.externalPlaceId, place.category);
    setDiscover(current => current.map(item => (
      item.id === id
        ? detail
          ? { ...item, description: detail.overview || item.description, image: detail.image || item.image, openingHours: detail.openingHours || item.openingHours, homepage: detail.homepage, detailFacts: detail.facts, tourDetailLoaded: true }
          : { ...item, tourDetailLoaded: true }
        : item
    )));
  }

  async function addSelectedToPlan(kind: "trip" | "date") {
    if (!selected) return;
    const label = kind === "date" ? "데이트 일정" : "여행 일정";
    setNoticeHref(kind === "date" ? "/date" : "/trip");
    if (!persist) {
      setNotice("로그인과 데이터베이스 연결이 필요해요.");
      return;
    }
    setPlanPending(kind);
    const result = await addItemToCouplePlan(kind, {
        id: `plan-${kind}-${selected.id}`,
        placeId: selected.id,
        placeName: selected.name,
        category: selected.categoryLabel,
        startTime: "13:00",
        durationMinutes: selected.durationMinutes || 60,
        expectedCost: selected.expectedCostTwo || 0,
        order: 0,
        memo: selected.description || "",
        dayIndex: kind === "trip" ? Number(searchParams.get("day") || 0) : 0,
        coordinates: selected.coordinates,
      }).catch(() => ({ error: `${label}에 담지 못했어요. 연결을 확인하고 다시 시도해 주세요.` }));
    if ("error" in result) {
      setNotice(result.error);
      setPlanPending(null);
      return;
    }
    setNotice(result.duplicate ? `${selected.name}은 이미 ${label}에 있어요.` : `${withObjectParticle(selected.name)} ${label}에 넣었어요.`);
    if (kind === "trip") setTripItems(result.items);
    setPlanPending(null);
    emitCoupleActivitiesChanged();
  }

  function handleSearch(formData?: FormData) {
    const nextQuery = formData ? String(formData.get("query") ?? "") : searchQuery;
    setSearchQuery(nextQuery);
    void runDiscover({ query: nextQuery, category: searchCategory, page: 1 });
  }

  function browseInput(group: string, area: string) {
    if (area.startsWith("custom:")) return { region: area.slice("custom:".length) };
    return browseDiscoverInput(group, area);
  }

  function runBrowse(next: { group?: string; area?: string; categories?: PlaceCategoryId[] }) {
    const group = next.group ?? browseGroup;
    const area = next.area ?? browseArea;
    const categories = next.categories ?? browseCategories;
    if (!group || !area) return;
    setBrowseResultQuery("");
    void runDiscover(
      categories.length
        ? { ...browseInput(group, area), categories, page: 1 }
        : { ...browseInput(group, area), category: "all", page: 1 },
    );
  }

  function runBrowseResultSearch() {
    const query = browseResultQuery.trim();
    if (!query) {
      runBrowse({});
      return;
    }
    const base = browseInput(browseGroup, browseArea);
    void runDiscover(browseCategories.length
      ? { ...base, query, categories: browseCategories, page: 1 }
      : { ...base, query, category: "all", page: 1 });
  }

  function toggleBrowseCategory(category: PlaceCategoryId) {
    const next = browseCategories.includes(category)
      ? browseCategories.filter(item => item !== category)
      : [...browseCategories, category];
    setBrowseCategories(next);
    runBrowse({ categories: next });
  }

  function applyRegionSearch(value: string) {
    const query = value.trim();
    if (!query) return;
    const region = selectedBrowseGroup && !query.includes(selectedBrowseGroup.label)
      ? `${selectedBrowseGroup.label} ${query}`
      : query;
    setBrowseRegionQuery(query);
    setBrowseArea(`custom:${region}`);
    setRegionSuggestionsOpen(false);
    void runDiscover(browseCategories.length
      ? { region, categories: browseCategories, page: 1 }
      : { region, category: "all", page: 1 });
  }

  function handleRegionSearch(formData: FormData) {
    applyRegionSearch(String(formData.get("region") ?? ""));
  }

  function handleLoadMore() {
    const nextPage = discoverPage + 1;
    if (section === "search") void runDiscover({ query: searchQuery, category: searchCategory, page: nextPage }, true);
    if (section === "browse") void runDiscover(browseCategories.length
      ? { ...browseInput(browseGroup, browseArea), ...(browseResultQuery.trim() ? { query: browseResultQuery.trim() } : {}), categories: browseCategories, page: nextPage }
      : { ...browseInput(browseGroup, browseArea), ...(browseResultQuery.trim() ? { query: browseResultQuery.trim() } : {}), category: "all", page: nextPage }, true);
    if (section === "map" && mapOrigin) void runDiscover({ ...mapOrigin, category: mapCategory, page: nextPage }, true);
  }

  function handleMapSearch(origin: { x: number; y: number; radius: number }) {
    setMapOrigin(origin);
    void runDiscover({ ...origin, category: mapCategory === "all" ? "cafe" : mapCategory, page: 1 });
  }

  const selectedBrowseGroup = areaGroupById(browseGroup);
  const regionSuggestions = (PLACE_ADMINISTRATIVE_AREAS[browseGroup] ?? [])
    .filter(area => !browseRegionQuery.trim() || area.toLowerCase().includes(browseRegionQuery.trim().toLowerCase()))
    .slice(0, 8);
  const visibleBrowseDiscover = discover;

  const copy = {
    saved: { title: "우리의 장소", body: null },
    search: { title: "장소 검색", body: "이름을 알면 찾아서 저장해요." },
    browse: { title: "지역별 둘러보기", body: "넓은 지역을 고른 뒤, 데이트하고 싶은 동네를 고르면 돼요." },
    map: { title: "지도에서 찾기", body: "지도를 옮긴 뒤, 지금 화면의 주변 장소를 가져와요." },
  }[section];

  return (
    <>
      {selected && (
        <ContextPanel>
          <PlaceDetailPanel
            key={selected.id}
            place={selected}
            preferredPlan={source}
            tripScheduleStops={selectedTripStops}
            planPending={planPending}
            savePending={isSavePending(selected)}
            onAdd={() => addSelectedToPlan("trip")}
            onAddDate={() => addSelectedToPlan("date")}
            onStatusChange={status => void persistStatus(selected.id, status)}
            onSave={() => openSave(selected)}
            onLocationSave={input => handleLocationSave(input)}
            onDescriptionSave={description => handleDescriptionSave(description)}
          />
        </ContextPanel>
      )}
      <div className="page-title-row">
        <div>
          <span className="eyebrow">OUR PLACE ARCHIVE</span>
          <h1>{copy.title}</h1>
          {copy.body && <p>{copy.body}</p>}
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
            {([
              ["all", "전체", counts.all, null],
              ["want", "가고 싶은 곳", counts.want, null],
              ["trip", "여행", tripPlaceCount, "trip"] as const,
              ["visited", "다녀온 곳", counts.visited, null],
              ["revisit", "또 가고 싶은 곳", counts.revisit, null],
              ["not_interested", "관심 없는 곳", counts.notInterested, null],
            ] as const).map(([id, label, count, kind]) => (
              <button className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)} key={id} type="button" role="tab" aria-selected={filter === id}>
                {kind === "trip" ? <PlaceTripFilterIcon className="status-tab-trip-icon" /> : null}
                {label} <b>{count}</b>
              </button>
            ))}
          </div>
          <div className="category-row">
            <button className={savedCategory === "all" ? "is-active" : ""} type="button" onClick={() => setSavedCategory("all")}>전체</button>
            {PLACE_CATEGORIES.map(item => <button className={savedCategory === item.id ? "is-active" : ""} type="button" onClick={() => setSavedCategory(item.id)} key={item.id}><PlaceCategoryIcon category={item.id} />{item.label}</button>)}
            <label><span>⌕</span><input id="place-archive-search" value={savedQuery} onChange={event => setSavedQuery(event.target.value)} placeholder="저장한 이름만 찾기" /></label>
          </div>
        </>
      )}

      {section === "search" && (
        <form
          className="discover-search"
          onSubmit={event => {
            event.preventDefault();
            handleSearch(new FormData(event.currentTarget));
          }}
          aria-busy={discoverPending}
        >
          <div className={`discover-search-bar${discoverPending ? " is-pending" : ""}`}>
            {discoverPending ? <i className="discover-search-spinner" aria-hidden="true" /> : null}
            <input
              name="query"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="성수 대림창고, 연남동 카페"
              aria-label="장소 이름 검색"
              disabled={discoverPending}
            />
            <button className="primary-button" type="submit" disabled={discoverPending}>
              {discoverPending ? <><i className="button-spinner" aria-hidden="true" />검색 중</> : "검색"}
            </button>
          </div>
          {discoverPending && (
            <p className="discover-search-status" role="status" aria-live="polite">
              <i aria-hidden="true" />
              <span><b>장소를 찾고 있어요</b> 카카오·구석구석에서 후보를 모으는 중이에요.</span>
            </p>
          )}
          <div className="chip-row discover-cats">
            <button className={searchCategory === "all" ? "is-active" : ""} type="button" disabled={discoverPending} onClick={() => {
              setSearchCategory("all");
              if (searchQuery.trim()) void runDiscover({ query: searchQuery.trim(), category: "all", page: 1 });
            }}>전체</button>
            {PLACE_CATEGORIES.map(item => <button className={searchCategory === item.id ? "is-active" : ""} type="button" disabled={discoverPending} onClick={() => {
              setSearchCategory(item.id);
              if (searchQuery.trim()) void runDiscover({ query: searchQuery.trim(), category: item.id, page: 1 });
            }} key={item.id}><PlaceCategoryIcon category={item.id} />{item.label}</button>)}
          </div>
        </form>
      )}

      {section === "browse" && (
        <div className="discover-browse">
          <div className="region-browser" aria-label="지역 선택">
            <div className="region-browser-head">
              <div><span>지역 둘러보기</span><strong>어디에서 함께 시간을 보낼까요?</strong></div>
              <p>지역과 장소 종류를 고르면 후보를 바로 보여드려요.</p>
            </div>
            <div className="region-tabs" role="tablist" aria-label="넓은 지역">
              {PLACE_AREA_GROUPS.map(group => (
                <button
                  className={browseGroup === group.id ? "is-active" : ""}
                  type="button"
                  key={group.id}
                  role="tab"
                  aria-selected={browseGroup === group.id}
                  onClick={() => {
                    setBrowseGroup(group.id);
                    setBrowseArea("all");
                    setBrowseRegionQuery("");
                    runBrowse({ group: group.id, area: "all" });
                  }}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div className="region-options" role="listbox" aria-label="세부 지역">
              <span className="region-section-label">추천 동네</span>
              {selectedBrowseGroup && <>
                <button
                  className={browseArea === "all" ? "is-active" : ""}
                  type="button"
                  role="option"
                  aria-selected={browseArea === "all"}
                  onClick={() => {
                    setBrowseArea("all");
                    setBrowseRegionQuery("");
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
                      setBrowseRegionQuery("");
                      runBrowse({ group: selectedBrowseGroup.id, area: item.id });
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </>}
            </div>
            <form className="region-search" onSubmit={event => {
              event.preventDefault();
              handleRegionSearch(new FormData(event.currentTarget));
            }}>
              <label htmlFor="region-detail-search"><span>시·군·구·동 직접 찾기</span><small>목록에 없는 지역도 검색할 수 있어요.</small></label>
              <div className="region-search-control" ref={regionSearchRef}>
                <span className="region-search-icon" aria-hidden="true">⌕</span>
                <input
                  id="region-detail-search"
                  name="region"
                  value={browseRegionQuery}
                  onChange={event => {
                    setBrowseRegionQuery(event.target.value);
                    setRegionSuggestionsOpen(true);
                  }}
                  onFocus={() => setRegionSuggestionsOpen(true)}
                  onKeyDown={event => {
                    if (event.key === "Escape") setRegionSuggestionsOpen(false);
                  }}
                  placeholder={`${selectedBrowseGroup?.label ?? "지역"}의 구·시·군·동 입력`}
                  role="combobox"
                  aria-expanded={regionSuggestionsOpen}
                  aria-controls="region-suggestions"
                  aria-autocomplete="list"
                  autoComplete="off"
                />
                <button className="region-apply-button" type="submit" disabled={discoverPending}>
                  {discoverPending ? <><i className="button-spinner" />찾는 중</> : "지역 적용"}
                </button>
                {regionSuggestionsOpen && regionSuggestions.length > 0 && (
                  <div className="region-suggestion-popover" id="region-suggestions" role="listbox" aria-label={`${selectedBrowseGroup?.label ?? "지역"} 세부 지역`}>
                    <span>추천 지역</span>
                    {regionSuggestions.map(area => (
                      <button type="button" role="option" aria-selected={browseRegionQuery === area} key={area} onClick={() => applyRegionSearch(area)}>
                        <b>{area}</b>
                        <small>{selectedBrowseGroup?.label}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>
            <div className="discover-filter">
              <span>장소 종류</span>
              <div className="chip-row">
                {PLACE_CATEGORIES.map(item => (
                  <button className={browseCategories.includes(item.id) ? "is-active" : ""} type="button" key={item.id} aria-pressed={browseCategories.includes(item.id)} disabled={discoverPending} onClick={() => toggleBrowseCategory(item.id)}><PlaceCategoryIcon category={item.id} />{item.label}</button>
                ))}
              </div>
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
                    <b className="place-list-title">{place.name}{tripLinkedPlaceIds.has(place.id) ? <PlaceTripStamp compact /> : null}</b>
                    <small>{place.categoryLabel} · {place.district}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="place-grid">{visibleSaved.map(place => (
              <PlaceCard
                key={place.id}
                place={place}
                selected={selectedId === place.id}
                onTripSchedule={tripLinkedPlaceIds.has(place.id)}
                onSelect={() => setSelectedId(place.id)}
                onToggleSave={() => toggleSave(place.id)}
                savePending={isSavePending(place)}
              />
            ))}</div>
          )
        ) : (
          <div className="empty-soft">
            <h1>{archivedPlaces.length ? "조건에 맞는 장소가 없어요" : "첫 장소를 골라 볼까요?"}</h1>
            <p>{archivedPlaces.length ? "필터를 바꾸거나 다른 이름으로 찾아 보세요." : "이름을 검색하거나, 알고 있는 장소를 직접 남겨 보세요."}</p>
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
          isEnd={discoverIsEnd}
          layout={layout}
          emptyTitle={searched ? "검색 결과가 없어요." : "장소 이름을 검색해 보세요."}
          emptyBody={searched ? "다른 이름이거나, 못 찾으면 직접 입력해 보세요." : "성수 대림창고처럼 알고 있는 이름을 넣으면 후보가 나와요."}
          onSelect={handleSelect}
          onSave={openSave}
          onLoadMore={!discoverIsEnd ? handleLoadMore : undefined}
          onManual={openManual}
          isSavePending={isSavePending}
        />
      )}

      {section === "browse" && (
        browseArea ? (
          <>
            {(discover.length > 0 || browseResultQuery) && (
              <form className="result-search-toolbar" onSubmit={event => { event.preventDefault(); runBrowseResultSearch(); }}>
                <div><b>{selectedBrowseGroup?.label ?? "선택 지역"} 전체 검색 결과</b><span>{visibleBrowseDiscover.length}곳</span></div>
                <label><span aria-hidden="true">⌕</span><input value={browseResultQuery} onChange={event => setBrowseResultQuery(event.target.value)} placeholder={`${selectedBrowseGroup?.label ?? "이 지역"}의 장소 이름·주소 검색`} aria-label="선택 지역 전체에서 검색" />{browseResultQuery && <button type="button" onClick={() => { setBrowseResultQuery(""); runBrowse({}); }} aria-label="검색어 지우기">×</button>}</label>
              </form>
            )}
            <PlaceDiscoverResults
              places={visibleBrowseDiscover}
              selectedId={selectedId}
              pending={discoverPending}
              error={discoverError}
              isEnd={discoverIsEnd}
              layout={layout}
              emptyTitle={browseResultQuery ? "이 지역에서 일치하는 장소가 없어요." : "이 동네의 후보가 아직 없어요."}
              emptyBody={browseResultQuery ? "다른 이름이나 주소로 다시 검색해 보세요." : "다른 동네를 고르거나, 종류를 바꿔 보세요."}
              onSelect={handleSelect}
              onSave={openSave}
              onLoadMore={!discoverIsEnd ? handleLoadMore : undefined}
              isSavePending={isSavePending}
            />
          </>
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
              isEnd={discoverIsEnd}
              layout="list"
              emptyTitle=""
              emptyBody=""
              onSelect={handleSelect}
              onSave={openSave}
              onLoadMore={!discoverIsEnd ? handleLoadMore : undefined}
              isSavePending={isSavePending}
            />
          )}
        </>
      )}

      <PlaceCreateDialog
        open={dialogOpen}
        mode={dialogMode}
        persist={persist}
        candidate={pendingCandidate}
        initialDescription={pendingInitialDescription}
        onClose={closePlaceDialog}
        onSaved={handleSaved}
        onPendingChange={setDialogPending}
      />
    </>
  );
}
