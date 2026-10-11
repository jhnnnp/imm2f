"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { readPlacesWorkspace } from "@/features/collaboration/workspaceReads";
import { SyncNotice } from "@/components/shared/SyncNotice";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { openContextPanel } from "@/components/layout/ContextPanelDrawer";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { PLACE_ADMINISTRATIVE_AREAS, PLACE_AREA_GROUPS, areaGroupById, browseDiscoverInput } from "../config/regions";
import { listPlaces, searchDiscoverPlaces, loadTourPlaceDetail, lookupPlaceLocation, updateMyPlaceStatus, updatePlaceDescription, updatePlaceLocation } from "../actions";
import { applyPlaceLocation } from "../location";
import { addItemToCouplePlan } from "@/features/planning/actions";
import { addPlacesToTrip } from "@/features/planning/tripPlaceBatch";
import { placePlanDestination } from "../planDestination";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { isDiscoverPlace, mergeCandidateWithSaved, placeToCandidate, uniqueByExternalId } from "../discover";
import type { DiscoverCandidate, Place, PlaceCategoryId, PlacePreferenceStatus } from "../types/place";
import { PlaceCard } from "./PlaceCard";
import { PlaceCreateDialog } from "./PlaceCreateDialog";
import { PlacesTripDialog } from "./PlacesTripDialog";
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
import { formatKoShort } from "@/lib/dates";
import type { FolderWorkspace } from "@/features/folders/types";
import { FOLDER_DRAG_MIME } from "@/features/folders/types";
import { useFolderWorkspace } from "@/features/folders/useFolderWorkspace";
import { FolderShelf } from "@/features/folders/components/FolderShelf";
import { FolderMoveMenu } from "@/features/folders/components/FolderMoveMenu";
import "./places-folders.css";

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
  initialTripStartDate = null,
  tripPlanTitle = "",
  initialArchivedTrips = [],
  initialFolderWorkspace,
}: {
  initialPlaces: Place[];
  persist: boolean;
  initialSelectedId?: string;
  initialTripItems?: PlanItem[];
  initialTripStartDate?: string | null;
  tripPlanTitle?: string;
  initialArchivedTrips?: ArchivedTripPlan[];
  initialFolderWorkspace?: FolderWorkspace;
}) {
  const folderController = useFolderWorkspace("places", initialFolderWorkspace);
  const searchParams = useSearchParams();
  const source = searchParams.get("from") === "date" ? "date" : searchParams.get("from") === "trip" ? "trip" : null;
  const tripDateParam = searchParams.has("tripDate") ? searchParams.get("tripDate") ?? "" : undefined;
  const tripDestination = placePlanDestination("trip", source, searchParams.get("day"), tripDateParam);
  const selectedTripDayLabel = source === "trip"
    ? `${tripDestination.targetDate === "" ? "날짜 미정 여행" : tripDestination.targetDate ? `${formatKoShort(tripDestination.targetDate)} 출발 여행` : "현재 여행"} · ${tripDestination.dayIndex + 1}일차`
    : undefined;
  const selectedParam = searchParams.get("selected") ?? initialSelectedId ?? "";
  const [places, setPlaces] = useState<Place[]>(initialPlaces);
  const [section, setSection] = useState<Section>(source ? "search" : "saved");
  const [selectedId, setSelectedId] = useState(
    selectedParam && initialPlaces.some(place => place.id === selectedParam)
      ? selectedParam
      : "",
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [savedCategory, setSavedCategory] = useState<SavedCategoryFilter>("all");
  const [tripItems, setTripItems] = useState<PlanItem[]>(initialTripItems);
  const [archivedTrips, setArchivedTrips] = useState<ArchivedTripPlan[]>(initialArchivedTrips);
  const [currentTripTitle, setCurrentTripTitle] = useState(tripPlanTitle);
  const [currentTripStartDate, setCurrentTripStartDate] = useState(initialTripStartDate);
  const [syncError, setSyncError] = useState("");
  const [savedQuery, setSavedQuery] = useState("");
  const [layout, setLayout] = useState<Layout>("grid");
  const [notice, setNotice] = useState("");
  const [noticePlanLink, setNoticePlanLink] = useState(false);
  const [noticeHref, setNoticeHref] = useState(placePlanDestination(source ?? "trip", source, searchParams.get("day"), tripDateParam).href);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("manual");
  const [pendingCandidate, setPendingCandidate] = useState<DiscoverCandidate | null>(null);
  const [pendingInitialDescription, setPendingInitialDescription] = useState("");
  const [planPending, setPlanPending] = useState<"trip" | "date" | null>(null);
  const [statusPendingId, setStatusPendingId] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogInitialFolderId, setDialogInitialFolderId] = useState<string | null>(null);
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  const [tripBatch, setTripBatch] = useState<{ ids: string[]; names: string[]; initialDate: string; initialDay: number } | null>(null);
  const [draggingPlaceIds, setDraggingPlaceIds] = useState<string[]>([]);

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
  const selectedParamRequestRef = useRef({ id: selectedParam, applied: false });
  const discoverRequestRef = useRef(0);
  const regionSearchRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  placesRef.current = places;
  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    const before = placesRef.current;
    try {
      const { places: result, trip, archives } = await readPlacesWorkspace(tripDestination.targetDate);
      if (!isCurrent() || before !== placesRef.current) return;
      if (result.persist) {
        setPlaces(result.places); setTripItems(trip.items); setArchivedTrips(archives); setCurrentTripTitle(trip.title); setCurrentTripStartDate(trip.startDate);
        setSyncError("");
      }
    } catch {
      if (isCurrent()) setSyncError("파트너의 최신 장소와 일정을 불러오지 못했어요.");
    }
  }, { tables: ["activities"], activityPrefixes: ["PLACE_", "TRIP_", "MEMORY_", "PARTNER_"] });

  const selectedParamExists = places.some(place => place.id === selectedParam)
    || discover.some(place => place.id === selectedParam);
  useEffect(() => {
    if (selectedParamRequestRef.current.id !== selectedParam) {
      selectedParamRequestRef.current = { id: selectedParam, applied: false };
    }
    if (!selectedParam || !selectedParamExists || selectedParamRequestRef.current.applied) return;
    // A URL selection opens once. Background refreshes must preserve later
    // tab changes and the place the user chooses within this screen.
    selectedParamRequestRef.current.applied = true;
    setSelectedId(selectedParam);
    setSection("saved");
    folderController.setSelectedFolderId(folderController.folderFor(selectedParam) ?? "unfiled");
  }, [selectedParam, selectedParamExists, folderController.setSelectedFolderId, folderController.folderFor]);

  useEffect(() => {
    if (!regionSuggestionsOpen) return;
    const closeSuggestions = (event: MouseEvent) => {
      if (!regionSearchRef.current?.contains(event.target as Node)) setRegionSuggestionsOpen(false);
    };
    document.addEventListener("mousedown", closeSuggestions);
    return () => document.removeEventListener("mousedown", closeSuggestions);
  }, [regionSuggestionsOpen]);

  useEffect(() => {
    const finishDrag = () => setDraggingPlaceIds([]);
    document.addEventListener("dragend", finishDrag);
    return () => document.removeEventListener("dragend", finishDrag);
  }, []);

  const archivedPlaces = useMemo(() => places.filter(isKeptInArchive), [places]);
  const folderPlaces = useMemo(() => archivedPlaces.filter(place => folderController.matchesFolder(place.id)),
    [archivedPlaces, folderController.matchesFolder]);
  const folderItems = useMemo(() => archivedPlaces.map(place => ({ id: place.id, title: place.name, image: place.image })), [archivedPlaces]);

  const counts = useMemo(() => ({
    all: folderPlaces.length,
    want: folderPlaces.filter(place => [place.userStatus, place.partnerStatus].some(value => value === "want" || value === "must_visit")).length,
    visited: folderPlaces.filter(place => [place.userStatus, place.partnerStatus].includes("visited")).length,
    revisit: folderPlaces.filter(place => [place.userStatus, place.partnerStatus].includes("revisit")).length,
    notInterested: folderPlaces.filter(place => [place.userStatus, place.partnerStatus].some(value => value === "not_interested" || value === "dislike")).length,
  }), [folderPlaces]);

  const tripPlaceCount = useMemo(
    () => folderPlaces.filter(place => placeIsOnAnyTrip(tripItems, archivedTrips, place)).length,
    [folderPlaces, tripItems, archivedTrips],
  );

  const tripLinkedPlaceIds = useMemo(
    () => new Set(archivedPlaces.filter(place => placeIsOnAnyTrip(tripItems, archivedTrips, place)).map(place => place.id)),
    [archivedPlaces, tripItems, archivedTrips],
  );

  const visibleSaved = useMemo(() => folderPlaces.filter(place => {
    const statuses: PlacePreferenceStatus[] = [place.userStatus, place.partnerStatus];
    const matchesStatus = filter === "trip"
      ? placeIsOnAnyTrip(tripItems, archivedTrips, place)
      : filter === "all"
        || (filter === "want" && statuses.some(value => value === "want" || value === "must_visit"))
        || (filter === "not_interested" && statuses.some(value => value === "not_interested" || value === "dislike"))
        || statuses.includes(filter);
    const matchesCategory = savedCategory === "all" || place.category === savedCategory;
    return matchesStatus && matchesCategory && place.name.toLowerCase().includes(savedQuery.toLowerCase());
  }), [folderPlaces, filter, savedCategory, savedQuery, tripItems, archivedTrips]);
  const visibleSelectedIds = visibleSaved.filter(place => selectedPlaceIds.includes(place.id)).map(place => place.id);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = visibleSelectedIds.length > 0 && visibleSelectedIds.length < visibleSaved.length;
  }, [visibleSelectedIds.length, visibleSaved.length, section, folderController.selectedFolderId]);
  const isFolderRoot = folderController.selectedFolderId === "root";
  const currentFolderName = folderController.workspace.folders.find(folder => folder.id === folderController.selectedFolderId)?.name;
  const hasSavedFilters = filter !== "all" || savedCategory !== "all" || Boolean(savedQuery.trim());

  const selected = (section === "saved" ? places : [...discover, ...places]).find(place => place.id === selectedId);

  const selectedTripStops = useMemo(
    () => (selected ? tripScheduleStopsForPlace(tripItems, currentTripTitle, archivedTrips, selected) : []),
    [selected, tripItems, currentTripTitle, archivedTrips],
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
      if (!append) setSelectedId("");
    } catch {
      if (requestId === discoverRequestRef.current) {
        setDiscoverError("장소를 불러오지 못했어요. 연결을 확인하고 다시 검색해 주세요.");
      }
    } finally {
      if (requestId === discoverRequestRef.current) {
        setDiscoverPending(false);
      }
    }
  }, []);

  async function persistStatus(id: string, status: PlacePreferenceStatus) {
    if (statusPendingId) return;
    setNoticePlanLink(false);
    const previous = places.find(place => place.id === id) ?? discover.find(place => place.id === id);
    const targetFolderId = selectedUserFolderId();
    const applyStatus = (current: Place[]) => current.map(place => place.id === id ? { ...place, userStatus: status } : place);
    setStatusPendingId(id);
    if (!persist) {
      setNotice("로그인과 데이터베이스 연결이 필요해요.");
      setStatusPendingId(null);
      return;
    }
    const result = await updateMyPlaceStatus(id, status)
      .catch(() => ({ error: "장소 상태를 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요." }));
    if (!("error" in result)) {
      const nextPlaces = applyStatus(placesRef.current);
      const updated = nextPlaces.find(place => place.id === id);
      setPlaces(nextPlaces);
      setDiscover(applyStatus);
      if (updated && !isKeptInArchive(updated)) {
        setSelectedId("");
      }
      emitCoupleActivitiesChanged();
      setStatusPendingId(null);
      if (updated && targetFolderId && previous && !isKeptInArchive(previous) && isKeptInArchive(updated)) {
        void assignSavedToFolder(updated.id, targetFolderId, `${updated.name}을 저장했어요.`);
      }
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
      setDialogInitialFolderId(selectedUserFolderId() ?? folderController.folderFor(place.id));
      setPendingInitialDescription(memoSeedForSaveDialog(place));
      setDialogMode("confirm");
      setDialogOpen(true);
      return;
    }

    toggleSave(place.id);
  }

  function openManual() {
    setDialogInitialFolderId(selectedUserFolderId());
    setPendingCandidate(null);
    setDialogMode("manual");
    setDialogOpen(true);
  }

  async function handleSaved(place: Place, message: string, folderId: string | null) {
    setPlaces(current => {
      const index = current.findIndex(item => item.id === place.id || (place.externalPlaceId && item.externalPlaceId === place.externalPlaceId && item.externalSource === place.externalSource));
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...current[index], ...place };
        return next;
      }
      return [...current, place];
    });
    setDiscover(current => current.map(item => (
      item.externalPlaceId && item.externalPlaceId === place.externalPlaceId && item.externalSource === place.externalSource ? { ...item, ...place } : item
    )));
    setSelectedId(place.id);
    setNotice(message);
    setNoticePlanLink(Boolean(source));
    if (source) setNoticeHref(placePlanDestination(source, source, searchParams.get("day"), tripDateParam).href);
    if (folderId !== folderController.folderFor(place.id)) {
      const moved = await assignSavedToFolder(place.id, folderId, message);
      if (moved && folderId) {
        const folder = folderController.workspace.folders.find(item => item.id === folderId);
        if (folder) setNotice(`${place.name} · ‘${folder.name}’에 저장했어요.`);
      }
    }
  }

  function selectedUserFolderId() {
    const id = folderController.selectedFolderId;
    return id !== "root" && id !== "all" && id !== "unfiled" ? id : null;
  }

  async function assignSavedToFolder(itemId: string, folderId: string | null, savedMessage: string) {
    const moved = await folderController.moveItems([itemId], folderId).catch(() => false);
    if (!moved) {
      setNoticePlanLink(false);
      setNotice(`${savedMessage} 폴더 이동 결과는 확인하지 못했어요. 저장한 장소에서 다시 확인해 주세요.`);
    }
    return moved;
  }

  function openSelectedPlacesTrip() {
    if (!visibleSelectedIds.length || planPending) return;
    setTripBatch({ ids: [...visibleSelectedIds], names: visibleSaved.filter(place => visibleSelectedIds.includes(place.id)).map(place => place.name),
      initialDate: tripDestination.targetDate ?? currentTripStartDate ?? "", initialDay: tripDestination.dayIndex });
  }

  async function addSelectedPlacesToTrip(input: { targetDate: string; dayIndex: number; spread: boolean }) {
    if (!tripBatch) return { error: "여행에 담을 장소를 다시 골라 주세요." };
    setPlanPending("trip");
    try {
      const result = await addPlacesToTrip(tripBatch.ids, input);
      if ("error" in result) return { error: result.error };
      if (tripDestination.targetDate === undefined || tripDestination.targetDate === input.targetDate) {
        setTripItems(result.items); setCurrentTripTitle(result.title); setCurrentTripStartDate(result.startDate || null);
      }
      setSelectedPlaceIds(current => current.filter(id => !tripBatch.ids.includes(id)));
      setNotice(result.added ? `${result.added}곳을 여행에 담았어요.${result.skipped ? ` 이미 담긴 ${result.skipped}곳은 유지했어요.` : ""}` : "선택한 장소가 이미 이 여행에 담겨 있어요.");
      setNoticePlanLink(true);
      setNoticeHref(`/trip?date=${encodeURIComponent(input.targetDate)}&day=${input.dayIndex}`);
      if (result.added) emitCoupleActivitiesChanged();
      return {};
    } finally { setPlanPending(null); }
  }

  function togglePlaceSelection(id: string) {
    setSelectedPlaceIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  function selectPlaceFolder(id: string) {
    folderController.setSelectedFolderId(id);
    setFilter("all");
    setSavedCategory("all");
    setSavedQuery("");
    setSelectedPlaceIds([]);
    setSelectedId("");
  }

  async function moveSelectedPlaces(folderId: string | null) {
    const ids = visibleSelectedIds;
    if (!ids.length) return;
    if (await folderController.moveItems(ids, folderId)) setSelectedPlaceIds(current => current.filter(id => !ids.includes(id)));
  }

  function dragSavedPlaces(event: DragEvent<HTMLElement>, id: string) {
    if (folderController.pending || !folderController.workspace.persist) { event.preventDefault(); return; }
    const ids = visibleSelectedIds.includes(id) ? visibleSelectedIds : [id];
    setDraggingPlaceIds(ids);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FOLDER_DRAG_MIME, JSON.stringify({ scope: "places", ids }));
    event.dataTransfer.setData("text/plain", `${ids.length}곳 · ${places.find(place => place.id === id)?.name ?? "선택한 장소"}`);
    document.dispatchEvent(new CustomEvent("only-us:folder-drag", { detail: "places" }));
  }

  function placeOrganization(place: Place) {
    return <div className="saved-place-organization">
      <label className="saved-place-select">
        <input type="checkbox" checked={selectedPlaceIds.includes(place.id)} disabled={folderController.pending}
          onChange={() => togglePlaceSelection(place.id)} aria-label={`${place.name} 정리할 장소로 선택`} />
        <span>선택</span>
      </label>
      <FolderMoveMenu folders={folderController.workspace.folders} value={folderController.folderFor(place.id)}
        disabled={folderController.pending || !folderController.workspace.persist} onMove={folderId => folderController.moveItems([place.id], folderId)} />
    </div>;
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
      setSelectedId("");
      setDiscover([]);
      setDiscoverError("");
      setSearched(false);
    }
  }

  async function handleSelect(id: string) {
    setSelectedId(id);
    openContextPanel();
    const place = [...discover, ...places].find(item => item.id === id);
    if (!place || place.externalSource !== "tourapi" || !place.externalPlaceId) return;
    if (place.tourDetailLoaded) return;
    const detail = await loadTourPlaceDetail(place.externalPlaceId, place.category,
      place.tourContentTypeId).catch(() => null);
    setDiscover(current => current.map(item => (
      item.id === id
        ? detail
          ? { ...item, sourceDescription: detail.overview, image: detail.image || item.image, openingHours: detail.openingHours || item.openingHours, homepage: detail.homepage, detailFacts: detail.facts, tourDetailLoaded: true }
          : { ...item, tourDetailLoaded: true }
        : item
    )));
  }

  async function addSelectedToPlan(kind: "trip" | "date") {
    if (!selected || planPending) return;
    const destination = placePlanDestination(kind, source, searchParams.get("day"), tripDateParam);
    const label = kind === "date" ? "데이트 일정" : "여행 일정";
    setNoticeHref(destination.href);
    setNoticePlanLink(false);
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
        memo: isDiscoverPlace(selected) ? "" : selected.description || "",
        dayIndex: destination.dayIndex,
        coordinates: selected.coordinates,
      }, { targetDate: destination.targetDate }).catch(() => ({ error: `${label}에 담지 못했어요. 연결을 확인하고 다시 시도해 주세요.` }));
    if ("error" in result) {
      setNotice(result.error);
      setPlanPending(null);
      return;
    }
    setNotice(result.duplicate ? `${selected.name}은 이미 ${label}에 있어요.` : `${withObjectParticle(selected.name)} ${label}에 넣었어요.`);
    setNoticePlanLink(true);
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
      <SyncNotice message={syncError} onRetry={retrySync} />
      {selected && (
        <ContextPanel>
          <PlaceDetailPanel
            key={selected.id}
            place={selected}
            preferredPlan={source}
            tripDestinationLabel={selectedTripDayLabel}
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

      {selectedTripDayLabel && <div className="place-trip-destination"><span><b>{selectedTripDayLabel}</b>에 넣을 장소를 골라요.</span><Link href={tripDestination.href}>여행으로 돌아가기 →</Link></div>}

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="장소 탐색">
          {SECTIONS.map(item => (
            <button className={section === item.id ? "is-active" : ""} onClick={() => handleSection(item.id)} key={item.id} type="button" role="tab" aria-selected={section === item.id}>
              {item.label}{item.id === "saved" ? <b>{archivedPlaces.length}</b> : null}
            </button>
          ))}
        </div>
        <div className="view-options">
          {(section !== "saved" || !isFolderRoot) && <><button className={layout === "grid" && section !== "map" ? "is-active" : ""} type="button" aria-label="그리드 보기" onClick={() => { setLayout("grid"); if (section === "map") setSection("search"); }}>▦</button>
          <button className={layout === "list" && section !== "map" ? "is-active" : ""} type="button" aria-label="목록 보기" onClick={() => { setLayout("list"); if (section === "map") setSection("search"); }}>☷</button></>}
          <button className={section === "map" ? "is-active" : ""} type="button" aria-label="지도 보기" onClick={() => handleSection("map")}>⌖</button>
        </div>
      </div>

      {section === "saved" && (
        <>
          <FolderShelf scope="places" controller={{ ...folderController, setSelectedFolderId: selectPlaceFolder }} items={folderItems} label="장소" />
          {!isFolderRoot && <div className="saved-place-content-controls">
          <div className="saved-place-content-heading"><h2>저장한 장소</h2><span>{folderPlaces.length}곳 함께 보관 중</span></div>
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
            <label><span>⌕</span><input id="place-archive-search" value={savedQuery} onChange={event => setSavedQuery(event.target.value)} placeholder={currentFolderName ? "이 폴더에서 이름 찾기" : "저장한 이름만 찾기"} aria-label="저장한 장소 이름 검색" /></label>
          </div>
          {visibleSaved.length > 0 && <div className="saved-place-selection-bar">
            <label><input ref={selectAllRef} type="checkbox" disabled={folderController.pending || Boolean(planPending)} checked={visibleSelectedIds.length === visibleSaved.length}
              onChange={event => setSelectedPlaceIds(event.target.checked ? visibleSaved.map(place => place.id) : [])} />현재 목록 모두 선택</label>
            <span aria-live="polite">{visibleSelectedIds.length ? `${visibleSelectedIds.length}곳 선택` : `${visibleSaved.length}곳 · 함께 정리하거나 여행에 담아요`}</span>
            {visibleSelectedIds.length > 0 && <>
              <FolderMoveMenu folders={folderController.workspace.folders} value={null} disabled={folderController.pending || !folderController.workspace.persist}
                onMove={moveSelectedPlaces} />
              <button className="saved-places-trip-button" type="button" onClick={openSelectedPlacesTrip} disabled={folderController.pending || Boolean(planPending) || !persist}><PlaceTripFilterIcon />여행에 추가</button>
              <button type="button" onClick={() => setSelectedPlaceIds([])} disabled={folderController.pending || Boolean(planPending)}>선택 해제</button>
            </>}
          </div>}
          </div>}
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

      {notice && <div className="inline-notice" role="status">{notice} {noticePlanLink ? <Link href={noticeHref}>{noticeHref.startsWith("/date") ? "데이트로 돌아가기" : "여행으로 돌아가기"}</Link> : null}<button type="button" onClick={() => setNotice("")} aria-label="알림 닫기">×</button></div>}

      {section === "saved" && !isFolderRoot && (
        visibleSaved.length ? (
          layout === "list" ? (
            <ul className="place-result-list">
              {visibleSaved.map(place => (
                <li key={place.id} className={`saved-place-file is-list${draggingPlaceIds.includes(place.id) ? " is-dragging" : ""}`} draggable={folderController.workspace.persist && !folderController.pending}
                  onDragStart={event => dragSavedPlaces(event, place.id)} onDragEnd={() => setDraggingPlaceIds([])}>
                  <button type="button" className={`kakao-result ${selectedId === place.id ? "is-selected" : ""}`} onClick={() => void handleSelect(place.id)}>
                    <b className="place-list-title">{place.name}{tripLinkedPlaceIds.has(place.id) ? <PlaceTripStamp compact /> : null}</b>
                    <small>{place.categoryLabel} · {place.district}</small>
                  </button>
                  {placeOrganization(place)}
                </li>
              ))}
            </ul>
          ) : (
            <div className="place-grid">{visibleSaved.map(place => (
              <div key={place.id} className={`saved-place-file${selectedPlaceIds.includes(place.id) ? " is-picked" : ""}${draggingPlaceIds.includes(place.id) ? " is-dragging" : ""}`}
                draggable={folderController.workspace.persist && !folderController.pending} onDragStart={event => dragSavedPlaces(event, place.id)} onDragEnd={() => setDraggingPlaceIds([])}>
              <PlaceCard
                place={place}
                selected={selectedId === place.id}
                onTripSchedule={tripLinkedPlaceIds.has(place.id)}
                onSelect={() => void handleSelect(place.id)}
                onToggleSave={() => toggleSave(place.id)}
                savePending={isSavePending(place)}
              />
              {placeOrganization(place)}
              </div>
            ))}</div>
          )
        ) : (
          <div className="empty-soft">
            <h2>{hasSavedFilters ? "조건에 맞는 장소가 없어요" : currentFolderName ? `‘${currentFolderName}’에 첫 장소를 담아 볼까요?` : folderController.selectedFolderId === "unfiled" ? "모든 장소가 폴더에 정리되어 있어요" : "첫 장소를 골라 볼까요?"}</h2>
            <p>{hasSavedFilters ? "이 폴더에서 필터를 바꾸거나 다른 이름으로 찾아 보세요." : currentFolderName ? "전체 장소에서 옮기거나, 새 장소를 저장하면 이 폴더에 담겨요." : folderController.selectedFolderId === "unfiled" ? "전체 장소나 다른 폴더를 열면 저장한 장소를 볼 수 있어요." : "이름을 검색하거나, 알고 있는 장소를 직접 남겨 보세요."}</p>
            <div className="dialog-actions">
              {(hasSavedFilters || folderController.selectedFolderId !== "all") && <button className="outline-button" type="button" onClick={() => {
                if (hasSavedFilters) { setFilter("all"); setSavedCategory("all"); setSavedQuery(""); }
                else selectPlaceFolder("all");
              }}>{hasSavedFilters ? "필터 초기화" : "전체 장소 보기"}</button>}
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
        folders={folderController.workspace.folders}
        initialFolderId={dialogInitialFolderId}
        onClose={closePlaceDialog}
        onSaved={handleSaved}
        onPendingChange={setDialogPending}
      />
      {tripBatch && <PlacesTripDialog names={tripBatch.names} initialDate={tripBatch.initialDate} initialDay={tripBatch.initialDay}
        onClose={() => setTripBatch(null)} onSubmit={addSelectedPlacesToTrip} />}
    </>
  );
}
