// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Place } from "../types/place";

const mocks = vi.hoisted(() => ({
  move: vi.fn().mockResolvedValue(true),
  saved: null as Place | null,
  folders: [{ id: "folder-seaside", name: "바다 보러 가는 날", color: "blue" }, { id: "folder-cafe", name: "조용한 오후", color: "sage" }],
  memberships: { "place-cafe": "folder-cafe", "place-sea": "folder-seaside" } as Record<string, string>,
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => vi.fn() }));
vi.mock("@/features/collaboration/workspaceReads", () => ({ readPlacesWorkspace: vi.fn() }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: vi.fn() }));
vi.mock("@/features/planning/actions", () => ({ addItemToCouplePlan: vi.fn() }));
vi.mock("../actions", () => ({ listPlaces: vi.fn(), searchDiscoverPlaces: vi.fn(), loadTourPlaceDetail: vi.fn(), lookupPlaceLocation: vi.fn(), updateMyPlaceStatus: vi.fn(), updatePlaceDescription: vi.fn(), updatePlaceLocation: vi.fn() }));
vi.mock("@/components/layout/ContextPanel", () => ({ ContextPanel: () => null }));
vi.mock("@/components/layout/ContextPanelDrawer", () => ({ openContextPanel: vi.fn() }));
vi.mock("./PlaceDetailPanel", () => ({ PlaceDetailPanel: () => null }));
vi.mock("./PlaceDiscoverResults", () => ({ PlaceDiscoverResults: () => createElement("div", null, "장소 검색 결과 영역") }));
vi.mock("./PlaceCard", () => ({ PlaceCard: ({ place, onSelect }: { place: Place; onSelect: () => void }) => createElement("article", { "aria-label": place.name }, createElement("button", { type: "button", onClick: onSelect }, place.name)) }));
vi.mock("./PlaceCreateDialog", () => ({ PlaceCreateDialog: ({ open, onSaved }: { open: boolean; onSaved: (place: Place, message: string) => void }) => open ? createElement("button", { onClick: () => onSaved(mocks.saved!, "새 장소를 저장했어요.") }, "모의 장소 저장") : null }));

vi.mock("@/features/folders/useFolderWorkspace", async () => {
  const { useCallback, useState } = await import("react");
  return { useFolderWorkspace: () => {
    const [selectedFolderId, setSelectedFolderId] = useState("all");
    const matchesFolder = useCallback((id: string) => selectedFolderId === "all" || (selectedFolderId === "unfiled" ? !mocks.memberships[id] : mocks.memberships[id] === selectedFolderId), [selectedFolderId]);
    return { workspace: { folders: mocks.folders, memberships: mocks.memberships, persist: true }, selectedFolderId, setSelectedFolderId,
      matchesFolder, folderFor: (id: string) => mocks.memberships[id] ?? null, moveItems: mocks.move, error: "", pending: false, reload: vi.fn() };
  } };
});
vi.mock("@/features/folders/components/FolderShelf", () => ({ FolderShelf: ({ controller }: { controller: { setSelectedFolderId: (id: string) => void } }) => createElement("section", { "aria-label": "폴더 탐색" },
  [ { id: "all", name: "전체 장소" }, { id: "unfiled", name: "폴더 밖" }, ...mocks.folders ].map(folder => createElement("button", { key: folder.id, onClick: () => controller.setSelectedFolderId(folder.id) }, folder.name))) }));
vi.mock("@/features/folders/components/FolderMoveMenu", () => ({ FolderMoveMenu: ({ onMove }: { onMove: (id: string | null) => Promise<unknown> }) => createElement("select", { "aria-label": "폴더로 이동", defaultValue: "", onChange: (event: { currentTarget: { value: string } }) => void onMove(event.currentTarget.value === "unfiled" ? null : event.currentTarget.value) },
  createElement("option", { value: "" }, "이동할 폴더"), createElement("option", { value: "unfiled" }, "폴더 밖으로"), ...mocks.folders.map(folder => createElement("option", { key: folder.id, value: folder.id }, folder.name))) }));

import { PlacesExperience } from "./PlacesExperience";

function place(id: string, name: string, overrides: Partial<Place> = {}): Place {
  return { id, name, category: "cafe", categoryLabel: "카페", district: "부산", description: "함께 가고 싶은 곳", durationMinutes: 60,
    expectedCostTwo: null, coordinates: [129.1, 35.1], visualTone: "green", userStatus: "want", partnerStatus: "neutral", userFit: 0, partnerFit: 0, ...overrides };
}
const places = [place("place-cafe", "마음 카페", { externalSource: "kakao", externalPlaceId: "42" }), place("place-sea", "바다 산책", { category: "nature", categoryLabel: "자연", userStatus: "visited" }), place("place-unfiled", "작은 책방", { category: "book", categoryLabel: "책방" })];
function mount() { return render(createElement(PlacesExperience, { initialPlaces: places, persist: true })); }
function cardFile(name: string) { return screen.getByRole("article", { name }).parentElement!; }
beforeEach(() => { mocks.move.mockReset().mockResolvedValue(true); mocks.saved = place("place-new", "새로 발견한 카페"); });
afterEach(cleanup);

it("opens named folders while keeping archive total and folder-scoped status counts", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "조용한 오후", exact: true }));
  expect(screen.getByRole("article", { name: "마음 카페" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "바다 산책" })).toBeNull();
  expect(screen.queryByRole("article", { name: "작은 책방" })).toBeNull();
  expect(screen.getByRole("tab", { name: /저장한 장소\s*3/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "가고 싶은 곳 1" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "다녀온 곳 0" })).toBeTruthy();
});

it("combines folder, category, status and search and offers a filter reset", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "바다 보러 가는 날", exact: true }));
  fireEvent.click(screen.getByRole("tab", { name: "다녀온 곳 1" }));
  fireEvent.click(screen.getByRole("button", { name: "자연", exact: true }));
  expect(screen.getByRole("article", { name: "바다 산책" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "저장한 장소 이름 검색" }), { target: { value: "없는 이름" } });
  expect(screen.getByText("조건에 맞는 장소가 없어요")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
  expect(screen.getByRole("article", { name: "바다 산책" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "마음 카페" })).toBeNull();
});

it("shows only unfiled places and keeps folder controls out of discovery", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "폴더 밖", exact: true }));
  expect(screen.getByRole("article", { name: "작은 책방" })).toBeTruthy();
  expect(screen.queryByRole("article", { name: "마음 카페" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "장소 찾기", exact: true }));
  expect(screen.queryByRole("region", { name: "폴더 탐색" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "폴더로 이동" })).toBeNull();
  expect(screen.getByText("장소 검색 결과 영역")).toBeTruthy();
});

it("starts a newly opened folder without the previous search or hidden selection", () => {
  mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "마음 카페 정리할 장소로 선택" }));
  fireEvent.change(screen.getByRole("textbox", { name: "저장한 장소 이름 검색" }), { target: { value: "카페" } });
  fireEvent.click(screen.getByRole("button", { name: "바다 보러 가는 날", exact: true }));
  expect(screen.getByRole("textbox", { name: "저장한 장소 이름 검색" })).toHaveProperty("value", "");
  expect(screen.getByRole("article", { name: "바다 산책" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "전체 장소", exact: true }));
  expect(screen.getByRole("checkbox", { name: "마음 카페 정리할 장소로 선택" })).toHaveProperty("checked", false);
});

it("moves selected visible places as one batch and clears selection after success", async () => {
  mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "마음 카페 정리할 장소로 선택" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "작은 책방 정리할 장소로 선택" }));
  const selectionBar = screen.getByText("2곳 선택").parentElement!;
  fireEvent.change(within(selectionBar).getByRole("combobox", { name: "폴더로 이동" }), { target: { value: "folder-seaside" } });
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith(["place-cafe", "place-unfiled"], "folder-seaside"));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "마음 카페 정리할 장소로 선택" })).toHaveProperty("checked", false));
});

it("keeps selection for retry when moving a batch fails", async () => {
  mocks.move.mockResolvedValue(false);
  mount();
  fireEvent.click(screen.getByRole("checkbox", { name: "현재 목록 모두 선택" }));
  fireEvent.change(within(screen.getByText("3곳 선택").parentElement!).getByRole("combobox"), { target: { value: "unfiled" } });
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith(places.map(item => item.id), null));
  expect(screen.getByRole("checkbox", { name: "현재 목록 모두 선택" })).toHaveProperty("checked", true);
});

it("sets a scoped drag payload for one place or the current selected group", () => {
  mount();
  const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(cardFile("마음 카페"), { dataTransfer });
  expect(dataTransfer.setData).toHaveBeenLastCalledWith("application/x-only-us-folder-items", JSON.stringify({ scope: "places", ids: ["place-cafe"] }));
  fireEvent.click(screen.getByRole("checkbox", { name: "마음 카페 정리할 장소로 선택" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "바다 산책 정리할 장소로 선택" }));
  fireEvent.dragStart(cardFile("바다 산책"), { dataTransfer });
  expect(dataTransfer.setData).toHaveBeenLastCalledWith("application/x-only-us-folder-items", JSON.stringify({ scope: "places", ids: ["place-cafe", "place-sea"] }));
});

it("offers individual and bulk folder actions in the list layout", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
  const row = screen.getByRole("button", { name: /마음 카페.*카페.*부산/ }).closest("li")!;
  fireEvent.change(within(row).getByRole("combobox"), { target: { value: "folder-seaside" } });
  expect(mocks.move).toHaveBeenCalledWith(["place-cafe"], "folder-seaside");
  expect(within(row).getByRole("checkbox", { name: "마음 카페 정리할 장소로 선택" })).toBeTruthy();
});

it("assigns a newly saved place to the folder that was open when saving began", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "조용한 오후", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "직접 입력", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "바다 보러 가는 날", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "모의 장소 저장" }));
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith(["place-new"], "folder-cafe"));
});

it("preserves a saved place and explains how to retry if folder assignment fails", async () => {
  mocks.move.mockResolvedValue(false);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "조용한 오후", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "직접 입력", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "모의 장소 저장" }));
  await waitFor(() => expect(screen.getByText(/폴더 이동은 완료되지 않았어요/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "전체 장소", exact: true }));
  expect(screen.getByRole("article", { name: "새로 발견한 카페" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "여행으로 돌아가기" })).toBeNull();
});

it("does not reorganize an already archived place when saving it again", async () => {
  mocks.saved = places[1];
  mount();
  fireEvent.click(screen.getByRole("button", { name: "조용한 오후", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "직접 입력", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "모의 장소 저장" }));
  await waitFor(() => expect(screen.getByText("새 장소를 저장했어요.")).toBeTruthy());
  expect(mocks.move).not.toHaveBeenCalled();
});

it("keeps provider identities separate when saving a place with the same external number", () => {
  mocks.saved = place("place-tour", "새 관광지", { externalSource: "tourapi", externalPlaceId: "42" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "직접 입력", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "모의 장소 저장" }));
  expect(screen.getByRole("article", { name: "마음 카페" })).toBeTruthy();
  expect(screen.getByRole("article", { name: "새 관광지" })).toBeTruthy();
});
