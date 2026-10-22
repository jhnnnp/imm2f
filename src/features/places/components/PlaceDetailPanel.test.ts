// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Place } from "../types/place";

vi.mock("@/features/auth/components/SessionProvider", () => ({ useAppSession: () => ({ mode: "authenticated",
  userId: "me", displayName: "지한", partner: { userId: "partner", displayName: "예린" } }) }));
vi.mock("./PlaceLocationMap", () => ({ PlaceLocationMap: () => null }));
vi.mock("./PlaceGraphicCover", () => ({ PlaceGraphicCover: () => null }));
vi.mock("../openPlaceMini", () => ({ openPlaceMiniWindow: vi.fn() }));
import { openPlaceMiniWindow } from "../openPlaceMini";
import { PlaceDetailPanel } from "./PlaceDetailPanel";

const place: Place = { id: "saved-cafe", name: "군산월명당", category: "cafe", categoryLabel: "카페",
  district: "군산시", address: "전북특별자치도 군산시 구영1길 37", description: "함께 먹고 싶은 초원빵",
  durationMinutes: 60, expectedCostTwo: null, coordinates: [126.709, 35.988], visualTone: "brown",
  userStatus: "want", partnerStatus: "visited", userFit: 0, partnerFit: 0,
  externalSource: "kakao", externalPlaceId: "123", mapUrl: "https://place.map.kakao.com/123" };
const props = () => ({ place, onAdd: vi.fn(), onAddDate: vi.fn(), onSave: vi.fn(), onStatusChange: vi.fn() });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("shows one selected status and the partner's independent read-only status", () => {
  const callbacks = props();
  render(createElement(PlaceDetailPanel, callbacks));
  const group = screen.getByRole("group", { name: "이 장소에 대한 내 마음" });
  expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);
  expect(within(group).getByRole("button", { name: "가고 싶어요" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("예린")).toBeTruthy();
  expect(screen.getByText("파트너의 마음")).toBeTruthy();
  expect(screen.getAllByText("다녀왔어요")).toHaveLength(2);
  fireEvent.click(within(group).getByRole("button", { name: "다녀왔어요" }));
  expect(callbacks.onStatusChange).toHaveBeenCalledExactlyOnceWith("visited");
  // The parent owns successful persistence; clicking never invents a saved state.
  expect(within(group).getByRole("button", { name: "가고 싶어요" }).getAttribute("aria-pressed")).toBe("true");
});

it.each(["must_visit", "dislike"] as const)("normalizes the legacy %s selection and toggles it to neutral", userStatus => {
  const callbacks = props();
  render(createElement(PlaceDetailPanel, { ...callbacks, place: { ...place, userStatus } }));
  const group = screen.getByRole("group", { name: "이 장소에 대한 내 마음" });
  const active = within(group).getByRole("button", { pressed: true });
  expect(active.textContent).toContain(userStatus === "must_visit" ? "가고 싶어요" : "관심 없어요");
  fireEvent.click(active);
  expect(callbacks.onStatusChange).toHaveBeenCalledExactlyOnceWith("neutral");
});

it("locks status and heart actions while the parent's save is pending", () => {
  const callbacks = props();
  render(createElement(PlaceDetailPanel, { ...callbacks, savePending: true }));
  const group = screen.getByRole("group", { name: "이 장소에 대한 내 마음" });
  expect(group.getAttribute("aria-busy")).toBe("true");
  for (const button of within(group).getAllByRole("button")) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    fireEvent.click(button);
  }
  const heart = screen.getByRole("button", { name: "장소 상태 저장 중" });
  expect((heart as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(heart);
  expect(callbacks.onStatusChange).not.toHaveBeenCalled();
  expect(callbacks.onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("저장하고 있어요");
});

it("keeps the provider map destination and separate date and trip actions", () => {
  const callbacks = props();
  render(createElement(PlaceDetailPanel, callbacks));
  fireEvent.click(screen.getByRole("button", { name: "카카오맵에서 보기" }));
  expect(openPlaceMiniWindow).toHaveBeenCalledWith(place.mapUrl, "kakao");
  fireEvent.click(screen.getByRole("button", { name: "네이버 지도에서 보기" }));
  expect(openPlaceMiniWindow).toHaveBeenLastCalledWith(expect.stringContaining(encodeURIComponent(place.name)), "naver");
  fireEvent.click(screen.getByRole("button", { name: "여행 일정에 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "데이트 일정에 추가" }));
  expect(callbacks.onAdd).toHaveBeenCalledOnce();
  expect(callbacks.onAddDate).toHaveBeenCalledOnce();
});

it("locks preview saving and both schedule actions during their pending operations", () => {
  const callbacks = props();
  render(createElement(PlaceDetailPanel, { ...callbacks, place: { ...place, id: "discover:kakao:123" },
    savePending: true, planPending: "trip" }));
  for (const name of ["장소 저장 중…", "여행에 담는 중...", "데이트 일정에 추가"]) {
    const button = screen.getByRole("button", { name });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(callbacks.onSave).not.toHaveBeenCalled();
  expect(callbacks.onAdd).not.toHaveBeenCalled();
  expect(callbacks.onAddDate).not.toHaveBeenCalled();
});

it("preserves a failed memo draft, prevents duplicate submits and allows retry", async () => {
  let reject!: (error: Error) => void;
  const onDescriptionSave = vi.fn().mockImplementationOnce(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }))
    .mockResolvedValueOnce({ error: "메모 권한을 다시 확인해 주세요." });
  render(createElement(PlaceDetailPanel, { ...props(), onDescriptionSave }));
  fireEvent.click(screen.getByRole("button", { name: "수정", exact: true }));
  const draft = screen.getByRole("textbox", { name: "우리 메모" });
  fireEvent.change(draft, { target: { value: "비 오는 날 다시 오기" } });
  const form = draft.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onDescriptionSave).toHaveBeenCalledExactlyOnceWith("비 오는 날 다시 오기");
  expect(form.getAttribute("aria-busy")).toBe("true");
  await act(async () => reject(new Error("network unavailable")));
  expect(screen.getByRole("alert").textContent).toContain("메모를 저장하지 못했어요");
  expect((draft as HTMLTextAreaElement).value).toBe("비 오는 날 다시 오기");
  expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("메모 권한을 다시 확인해 주세요."));
  expect(onDescriptionSave).toHaveBeenCalledTimes(2);
});

it("restores location controls and the entered address after a rejected save", async () => {
  const onLocationSave = vi.fn().mockRejectedValue(new Error("network unavailable"));
  render(createElement(PlaceDetailPanel, { ...props(), onLocationSave }));
  fireEvent.click(screen.getByRole("button", { name: "수정", exact: true }));
  const address = screen.getByRole("textbox", { name: "주소" });
  fireEvent.change(address, { target: { value: "전북 군산시 새 주소 1" } });
  fireEvent.click(screen.getByRole("button", { name: "위치 저장" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("위치를 저장하지 못했어요"));
  expect(onLocationSave).toHaveBeenCalledExactlyOnceWith({ address: "전북 군산시 새 주소 1", district: place.district });
  expect((address as HTMLInputElement).value).toBe("전북 군산시 새 주소 1");
  expect((screen.getByRole("button", { name: "위치 저장" }) as HTMLButtonElement).disabled).toBe(false);
});
