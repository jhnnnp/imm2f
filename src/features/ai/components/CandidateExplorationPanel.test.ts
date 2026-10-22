// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CandidateExplorationPreferences, CandidateGroup, ExplorationCard } from "../candidateExploration";
vi.mock("@/features/places/openPlaceMini", () => ({ openPlaceMiniWindow: vi.fn() }));
import { CandidateExplorationPanel } from "./CandidateExplorationPanel";

const preferences: CandidateExplorationPreferences = {
  activities: ["cafe"], cafeQualities: [], cuisines: [], shoppingKinds: [], cultureKinds: [], additionalDetails: "",
  pace: "balanced", provenance: {},
};
const groups: CandidateGroup[] = [{ id: "cafe", title: "카페 후보", description: "확인한 후보", needIds: [], availableCount: 0, cards: [] }];
function props(overrides: Partial<Parameters<typeof CandidateExplorationPanel>[0]> = {}) {
  return { area: "성수", nights: 0, preferences, groups, selectedIds: [], selectedCards: [], rejectedIds: [], busy: false,
    onPreferencesChange: vi.fn(), onSearch: vi.fn(), onSelect: vi.fn(), onReject: vi.fn(), onMore: vi.fn(),
    onRefine: vi.fn().mockResolvedValue(true), onDetail: vi.fn(), onPlan: vi.fn(), onEdit: vi.fn(), ...overrides };
}
afterEach(cleanup);

function candidate(index: number, overrides: Partial<ExplorationCard> = {}): ExplorationCard {
  return { candidateId: `kakao:${index}`, name: `카페 ${index}`, area: "성수", category: "카페",
    address: "서울 성동구 성수동", mapUrl: `https://place.map.kakao.com/${index}`,
    badges: [], reason: "선택한 지역에서 확인한 카페 후보입니다.", factLabel: "검색 근거", evidenceUrls: [], ...overrides };
}

it("allows another place to be selected after nine choices, with no capacity counter or warning", () => {
  const chosen = Array.from({ length: 9 }, (_, index) => candidate(index + 1));
  const next = candidate(10);
  const panelProps = props({ selectedIds: chosen.map(card => card.candidateId), selectedCards: chosen,
    groups: [{ ...groups[0], cards: [...chosen, next], availableCount: 10 }] });
  render(createElement(CandidateExplorationPanel, panelProps));
  expect(screen.getByText("선택한 장소 9곳")).toBeTruthy();
  const select = within(screen.getByRole("article", { name: next.name })).getByRole("button", { name: "장소 선택" });
  expect(select).toHaveProperty("disabled", false);
  fireEvent.click(select);
  expect(panelProps.onSelect).toHaveBeenCalledWith(next);
  expect(screen.queryByText(/선택 장소 수에 도달/)).toBeNull();
});

it("shows grounded reasons, full address and safe evidence without repeating the category as a badge", () => {
  const card = candidate(1, { badges: ["카페", "디저트", "테라스", "디저트"],
    reason: "제공 자료에 디저트 메뉴와 테라스 좌석이 안내되어 있어 선택한 조건과 비교할 수 있어요. 운영 시간은 방문 전에 확인해 주세요.",
    factLabel: "제공 자료 근거", evidenceUrls: ["https://venue.example.com/guide", "https://venue.example.com/guide", "javascript:alert(1)", "https://user:secret@unsafe.example.com"] });
  render(createElement(CandidateExplorationPanel, props({ groups: [{ ...groups[0], cards: [card], availableCount: 1 }] })));
  expect(screen.getByText(card.reason)).toBeTruthy();
  expect(screen.getByText(card.address)).toBeTruthy();
  expect(screen.getAllByText("디저트", { exact: true })).toHaveLength(1);
  expect(screen.getByText("테라스", { exact: true })).toBeTruthy();
  const sources = screen.getAllByRole("link");
  expect(sources).toHaveLength(1);
  expect(sources[0]).toHaveProperty("href", "https://venue.example.com/guide");
  expect(sources[0].getAttribute("rel")).toBe("noopener noreferrer");
});

it("adds useful visit checks to older cards that only contain a place type, without inventing venue facts", () => {
  const card = candidate(1, { name: "전망대 후보", category: "관광명소", reason: "전망대", factLabel: "장소 유형" });
  render(createElement(CandidateExplorationPanel, props({ preferences: { ...preferences, activities: ["nightview"] },
    groups: [{ ...groups[0], id: "nightview", title: "야경", cards: [card], availableCount: 1 }] })));
  expect(screen.getByText("전망대", { exact: true })).toBeTruthy();
  expect(screen.getByText("선택한 야경 조건으로 찾은 장소예요. 주소와 동선을 비교해 골라 주세요.")).toBeTruthy();
  expect(screen.getByText("야간 개방 여부와 접근 경로를 살펴보세요.")).toBeTruthy();
  expect(screen.queryByText(/야간 개방이 확인/)).toBeNull();
});

it.each(["structured", "transport"])("retains refinement text after a %s failure for retry", async failure => {
  const onRefine = failure === "structured" ? vi.fn().mockResolvedValue(false) : vi.fn().mockRejectedValue(new Error("network"));
  render(createElement(CandidateExplorationPanel, props({ onRefine })));
  const input = screen.getByRole("textbox", { name: "카페 후보 조건 다듬기" });
  fireEvent.change(input, { target: { value: "바다 보이는 곳" } });
  fireEvent.click(screen.getByRole("button", { name: "조건 다듬기", exact: true }));
  await waitFor(() => expect(onRefine).toHaveBeenCalledTimes(1));
  await act(async () => undefined);
  expect(input).toHaveProperty("value", "바다 보이는 곳");
  fireEvent.click(screen.getByRole("button", { name: "조건 다듬기", exact: true }));
  await waitFor(() => expect(onRefine).toHaveBeenCalledTimes(2));
});

it("clears a successfully applied refinement", async () => {
  const inputProps = props();
  render(createElement(CandidateExplorationPanel, inputProps));
  const input = screen.getByRole("textbox", { name: "카페 후보 조건 다듬기" });
  fireEvent.change(input, { target: { value: "조용한 곳" } });
  fireEvent.click(screen.getByRole("button", { name: "조건 다듬기", exact: true }));
  await waitFor(() => expect(input).toHaveProperty("value", ""));
  expect(inputProps.onRefine).toHaveBeenCalledWith("cafe", "조용한 곳");
});

it("does not discard a newer draft when a previous refinement completes", async () => {
  let resolve!: (result: boolean) => void;
  const onRefine = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
  render(createElement(CandidateExplorationPanel, props({ onRefine })));
  const input = screen.getByRole("textbox", { name: "카페 후보 조건 다듬기" });
  fireEvent.change(input, { target: { value: "조용한 곳" } });
  fireEvent.click(screen.getByRole("button", { name: "조건 다듬기", exact: true }));
  fireEvent.change(input, { target: { value: "디저트가 있는 곳" } });
  await act(async () => resolve(true));
  expect(input).toHaveProperty("value", "디저트가 있는 곳");
});

it("sends one refinement across repeated submissions before the busy prop updates", async () => {
  let resolve!: (result: boolean) => void;
  const onRefine = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
  render(createElement(CandidateExplorationPanel, props({ onRefine })));
  const input = screen.getByRole("textbox", { name: "카페 후보 조건 다듬기" });
  fireEvent.change(input, { target: { value: "조용한 곳" } });
  act(() => { fireEvent.submit(input.closest("form")!); fireEvent.submit(input.closest("form")!); });
  expect(onRefine).toHaveBeenCalledTimes(1);
  await act(async () => resolve(true));
});

it.each([{ isComposing: true }, { keyCode: 229 }])("prevents the form default during Korean IME Enter (%j)", properties => {
  const inputProps = props();
  render(createElement(CandidateExplorationPanel, inputProps));
  const input = screen.getByRole("textbox", { name: "카페 후보 조건 다듬기" });
  fireEvent.change(input, { target: { value: "조용한 곳" } });
  expect(fireEvent.keyDown(input, { key: "Enter", ...properties })).toBe(false);
  expect(inputProps.onRefine).not.toHaveBeenCalled();
});
