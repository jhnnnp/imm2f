// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AIPlannerReply, AIPlannerState, PlanItem } from "@/features/planning/types/plan";

const mocks = vi.hoisted(() => ({
  recommend: vi.fn(), propose: vi.fn(), prepare: vi.fn(), explore: vi.fn(), replaceRejected: vi.fn(), choices: vi.fn(),
  openPlace: vi.fn(),
}));
vi.mock("../actions", () => ({ recommendDatePlanWithSession: mocks.recommend, proposePlanEdits: mocks.propose }));
vi.mock("../candidateExplorationActions", () => ({
  prepareCandidateExploration: mocks.prepare, exploreCandidateGroups: mocks.explore,
  replaceRejectedCandidateFromSession: mocks.replaceRejected, updateCandidateExplorationChoices: mocks.choices,
}));
vi.mock("@/features/places/openPlaceMini", () => ({ openPlaceMiniWindow: mocks.openPlace }));
vi.mock("@/features/trip/components/PlanMap", () => ({ PlanMap: () => null }));
vi.mock("@/features/places/components/PlaceLocationMap", () => ({ PlaceLocationMap: () => null }));
vi.mock("@/components/shared/CalendarMonth", () => ({ CalendarMonth: () => null }));
import { emptyDateBrief, withAreas } from "../dateBrief";
import { explorationResearchPlan, type CandidateExplorationPreferences, type ExplorationCard } from "../candidateExploration";
import { AIPlanEditor } from "./AIPlanEditor";

const item: PlanItem = {
  id: "place-one", placeId: "kakao:1", placeName: "확인한 카페", category: "카페",
  startTime: "14:00", durationMinutes: 60, expectedCost: 10000, order: 0, memo: "", dayIndex: 0,
};
const completeState = (): AIPlannerState => ({ ...withAreas(emptyDateBrief(), ["성수"]),
  stayKind: "date", timeWindow: "any", cuisine: "any", intakeFocusDone: true, areaScope: "core" });
function plan(): AIPlannerReply {
  return {
    status: "plan", message: "검증한 코스입니다", card: { headline: "추천 코스", lines: ["확인한 장소로 만들었어요."] },
    condition: { dateLabel: "2026-10-11", startTime: "14:00", endTime: "15:00", budget: null, region: "성수", timeSpecified: false },
    recommendations: [{ id: "1", placeId: item.placeId, name: item.placeName, category: "카페", district: "성수",
      address: "서울 성동구", phone: "", mapUrl: "https://place.map.kakao.com/1", coordinates: null,
      durationMinutes: 60, expectedCost: 10000, reasons: [], isSaved: false, distanceFromPreviousMeters: null }],
    items: [item], candidateCount: 1, source: "fallback", state: completeState(),
  };
}
const chat = (message = "새 답변") => ({ result: { status: "chat", message,
  card: { headline: "답변", lines: [message] }, state: completeState() }, sessionCandidates: null });
function editorProps(overrides: Partial<Parameters<typeof AIPlanEditor>[0]> = {}) {
  return { kind: "date" as const, items: [] as PlanItem[], startDate: "2026-10-11", onApply: vi.fn(), onReplace: vi.fn(), ...overrides };
}
function send(message: string) {
  const composer = screen.getByRole("textbox", { name: "AI 플래너에게 메시지" });
  fireEvent.change(composer, { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
  return composer as HTMLTextAreaElement;
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recommend.mockResolvedValue(chat());
  mocks.propose.mockResolvedValue({ changes: [{ type: "duration", itemId: item.id, minutes: 90, label: "체류 시간", detail: "90분" }], summary: "더 여유롭게" });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([{ isComposing: true }, { keyCode: 229 }])("does not send Enter while a Korean IME is composing (%j)", properties => {
  render(createElement(AIPlanEditor, editorProps()));
  const composer = screen.getByRole("textbox", { name: "AI 플래너에게 메시지" });
  fireEvent.change(composer, { target: { value: "성수에서 카페" } });
  fireEvent.keyDown(composer, { key: "Enter", ...properties });
  expect(mocks.recommend).not.toHaveBeenCalled();
  expect(composer).toHaveProperty("value", "성수에서 카페");
});

it("keeps Shift + Enter for a newline and ignores empty Enter without starting intake or AI", () => {
  render(createElement(AIPlanEditor, editorProps()));
  const composer = screen.getByRole("textbox", { name: "AI 플래너에게 메시지" });
  fireEvent.keyDown(composer, { key: "Enter" });
  fireEvent.change(composer, { target: { value: "성수 카페" } });
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  expect(mocks.recommend).not.toHaveBeenCalled();
  expect(screen.getByText("어떤 데이트를 계획할까요?")).toBeTruthy();
});

it("starts one AI request even when Enter events arrive before React renders the loading state", async () => {
  const response = deferred<ReturnType<typeof chat>>();
  mocks.recommend.mockReturnValue(response.promise);
  render(createElement(AIPlanEditor, editorProps()));
  const composer = screen.getByRole("textbox", { name: "AI 플래너에게 메시지" });
  fireEvent.change(composer, { target: { value: "성수 카페" } });
  act(() => {
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.keyDown(composer, { key: "Enter" });
  });
  expect(mocks.recommend).toHaveBeenCalledTimes(1);
  await act(async () => response.resolve(chat()));
  expect(composer).toHaveProperty("disabled", false);
});

it.each([false, true])("preserves a failed request for retry after a structured or transport error (%s)", async transport => {
  if (transport) mocks.recommend.mockRejectedValueOnce(new Error("Failed to fetch"));
  else mocks.recommend.mockResolvedValueOnce({ result: { error: "조건에 맞는 장소를 못 찾았어요" }, sessionCandidates: null });
  render(createElement(AIPlanEditor, editorProps()));
  const composer = send("성수 조용한 카페");
  await waitFor(() => expect(composer).toHaveProperty("disabled", false));
  expect(composer.value).toBe("성수 조용한 카페");
  fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(2));
  expect(mocks.recommend.mock.calls[1][0].message).toBe("성수 조용한 카페");
});

it("discards a response from the previous date and starts a fresh conversation session", async () => {
  const response = deferred<ReturnType<typeof chat>>();
  mocks.recommend.mockReturnValueOnce(response.promise);
  const props = editorProps();
  const view = render(createElement(AIPlanEditor, props));
  send("이전 날짜 요청");
  const oldSession = mocks.recommend.mock.calls[0][0].planningSessionId;
  view.rerender(createElement(AIPlanEditor, { ...props, startDate: "2026-10-12" }));
  await act(async () => response.resolve(chat("이전 날짜 답변")));
  expect(screen.queryByText("이전 날짜 답변")).toBeNull();
  expect(screen.queryByText("이전 날짜 요청")).toBeNull();
  send("새 날짜 요청");
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(2));
  const input = mocks.recommend.mock.calls[1][0];
  expect(input.dateLabel).toBe("2026-10-12");
  expect(input.planKind).toBe("date");
  expect(input.planningSessionId).not.toBe(oldSession);
  expect(input.conversation).toEqual([{ role: "user", text: "새 날짜 요청" }]);
});

it("rejects an edit reply if the partner or selected trip day changed its input items", async () => {
  const response = deferred<{ changes: never[]; summary: string }>();
  mocks.propose.mockReturnValueOnce(response.promise);
  const props = editorProps({ kind: "trip", items: [item] });
  const view = render(createElement(AIPlanEditor, props));
  fireEvent.click(screen.getByRole("button", { name: "변경안 만들기" }));
  view.rerender(createElement(AIPlanEditor, { ...props, items: [{ ...item, durationMinutes: 150 }] }));
  await act(async () => response.resolve({ changes: [], summary: "오래된 응답" }));
  expect(screen.queryByText("오래된 응답")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("일정이 바뀌었어요");
  expect(props.onApply).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "변경안 만들기" })).toHaveProperty("disabled", false);
});

it("invalidates an already visible proposal when schedule items change", async () => {
  const props = editorProps({ kind: "trip", items: [item] });
  const view = render(createElement(AIPlanEditor, props));
  fireEvent.click(screen.getByRole("button", { name: "변경안 만들기" }));
  await screen.findByRole("button", { name: "선택한 1개 적용" });
  view.rerender(createElement(AIPlanEditor, { ...props, items: [{ ...item, startTime: "16:00" }] }));
  expect(screen.queryByRole("button", { name: "선택한 1개 적용" })).toBeNull();
  expect(props.onApply).not.toHaveBeenCalled();
});

it("applies a proposal only once across clicks arriving in the same render", async () => {
  const props = editorProps({ kind: "trip", items: [item] });
  render(createElement(AIPlanEditor, props));
  fireEvent.click(screen.getByRole("button", { name: "변경안 만들기" }));
  const apply = await screen.findByRole("button", { name: "선택한 1개 적용" });
  act(() => { fireEvent.click(apply); fireEvent.click(apply); });
  expect(props.onApply).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "선택한 1개 적용" })).toBeNull();
});

it("does not call the edit action for an empty request", () => {
  render(createElement(AIPlanEditor, editorProps({ kind: "trip", items: [item] })));
  fireEvent.change(screen.getByRole("textbox", { name: "요청" }), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "변경안 만들기" }));
  expect(mocks.propose).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("적어 주세요");
});

it("keeps old clarification choices inactive when a newer question has the same label", async () => {
  const clarification = (slot: "time" | "cuisine", message: string) => ({ result: {
    status: "clarification", message, card: { headline: message, lines: [message] }, state: completeState(),
    options: ["상관없음"], multiple: false, slot,
  }, sessionCandidates: null });
  mocks.recommend.mockResolvedValueOnce(clarification("time", "시작 시간 질문"))
    .mockResolvedValueOnce(clarification("cuisine", "음식 종류 질문"));
  render(createElement(AIPlanEditor, editorProps()));
  send("성수 데이트");
  const oldChoice = await screen.findByRole("button", { name: "상관없음" });
  send("음식 종류부터 고를게");
  await screen.findAllByRole("button", { name: "상관없음" });
  await waitFor(() => expect(oldChoice).toHaveProperty("disabled", true));
  const currentChoice = screen.getAllByRole("button", { name: "상관없음" }).at(-1)!;
  expect(currentChoice).toHaveProperty("disabled", false);
  fireEvent.click(oldChoice);
  expect(mocks.recommend).toHaveBeenCalledTimes(2);
});

it("saves a recommended course once across repeated keep clicks", async () => {
  mocks.recommend.mockResolvedValueOnce({ result: plan(), sessionCandidates: null });
  const saved = deferred<{ ok: true }>();
  const onKeep = vi.fn(() => saved.promise);
  render(createElement(AIPlanEditor, editorProps({ onKeep })));
  send("성수 코스");
  fireEvent.click(await screen.findByRole("button", { name: "이 코스 담기" }));
  const destination = screen.getAllByRole("button", { name: "데이트 코스로 담기" }).at(-1)!;
  act(() => { fireEvent.click(destination); fireEvent.click(destination); });
  await waitFor(() => expect(onKeep).toHaveBeenCalledTimes(1));
  await act(async () => saved.resolve({ ok: true }));
  expect(screen.getByText("데이트 코스에 담았습니다", { exact: true })).toBeTruthy();
});

it("shows a recoverable keep error and permits retrying the same course", async () => {
  mocks.recommend.mockResolvedValueOnce({ result: plan(), sessionCandidates: null });
  const onKeep = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true });
  render(createElement(AIPlanEditor, editorProps({ onKeep })));
  send("성수 코스");
  fireEvent.click(await screen.findByRole("button", { name: "이 코스 담기" }));
  fireEvent.click(screen.getAllByRole("button", { name: "데이트 코스로 담기" }).at(-1)!);
  await screen.findByText("담지 못했습니다");
  const destination = screen.getAllByRole("button", { name: "데이트 코스로 담기" }).at(-1)!;
  expect(destination).toHaveProperty("disabled", false);
  fireEvent.click(destination);
  await waitFor(() => expect(onKeep).toHaveBeenCalledTimes(2));
  expect(onKeep.mock.calls[1][0]).toEqual(onKeep.mock.calls[0][0]);
});

it("does not render unsafe evidence links or open an unsafe provider map URL", async () => {
  mocks.recommend.mockResolvedValueOnce({ result: { status: "chat", message: "장소 안내", state: completeState(),
    card: { headline: "장소", lines: ["확인해 보세요"], sources: [{ label: "허용 출처", url: "https://example.com/facts" },
      { label: "위험 출처", url: "javascript:alert(1)" }], stops: [{ name: "확인한 카페", meta: "카페",
      mapUrl: "javascript:alert(1)", factSourceUrl: "data:text/html,unsafe" }] } }, sessionCandidates: null });
  render(createElement(AIPlanEditor, editorProps()));
  send("장소 알려줘");
  expect(await screen.findByRole("link", { name: /허용 출처/ })).toHaveProperty("href", "https://example.com/facts");
  expect(screen.queryByRole("link", { name: /위험 출처/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "확인한 카페 카카오맵에서 보기" }));
  expect(mocks.openPlace.mock.calls[0][0]).toMatch(/^https:\/\/(?:map|place\.map)\.kakao\.com\//);
  fireEvent.click(screen.getByRole("button", { name: /확인한 카페 카페 장소 정보 보기/ }));
  const peek = screen.getByRole("region", { name: "확인한 카페 미리보기" });
  expect(within(peek).queryByText("출처", { exact: true })).toBeNull();
});

it("keeps all days of a multi-day recommendation by directing it to a trip destination", async () => {
  const recommendation = { ...plan(), items: [item, { ...item, id: "place-two", dayIndex: 1 }],
    state: { ...completeState(), stayKind: "overnight", nights: 1 } };
  mocks.recommend.mockResolvedValueOnce({ result: recommendation, sessionCandidates: null });
  const onKeep = vi.fn();
  render(createElement(AIPlanEditor, editorProps({ onKeep })));
  send("성수 1박2일");
  fireEvent.click(await screen.findByRole("button", { name: "이 코스 담기" }));
  expect(screen.getByRole("button", { name: "데이트 코스로 담기" })).toHaveProperty("disabled", true);
  send("데이트 코스로 담기");
  await screen.findByText("여행 일정으로 담아 주세요", { exact: true });
  expect(onKeep).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "여행에 담기" }).at(-1)!);
  expect(await screen.findByRole("button", { name: "이 날짜로 여행에 담기" })).toHaveProperty("disabled", false);
});

it("restores the initial request when exploration preparation fails", async () => {
  mocks.prepare.mockRejectedValueOnce(new Error("network"));
  render(createElement(AIPlanEditor, editorProps({ candidateExplorationActive: true })));
  const composer = send("부산 1박2일 카페");
  await waitFor(() => expect(composer).toHaveProperty("disabled", false));
  expect(composer.value).toBe("부산 1박2일 카페");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.recommend).not.toHaveBeenCalled();
});

it("passes the trip UI context to exploration intake without inventing a duration", async () => {
  mocks.prepare.mockResolvedValueOnce({ state: completeState(), needsArea: false, needsSpan: true });
  render(createElement(AIPlanEditor, editorProps({ kind: "trip", candidateExplorationActive: true })));
  send("성수 카페");
  await screen.findByText("여행 기간을 알려 주세요", { exact: true });
  expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ message: "성수 카페", planKind: "trip" });
  expect(mocks.explore).not.toHaveBeenCalled();
});

const preferences: CandidateExplorationPreferences = { activities: ["cafe"], cafeQualities: [], cuisines: [],
  shoppingKinds: [], cultureKinds: [], additionalDetails: "", pace: "balanced", provenance: {} };
function mockExploration(cardCount = 1) {
  const cards: ExplorationCard[] = Array.from({ length: cardCount }, (_, index) => ({ candidateId: `kakao:${index + 1}`,
    name: `후보 ${index + 1}`, area: "성수", category: "카페", mapUrl: `https://place.map.kakao.com/${index + 1}`,
    address: "서울 성동구", badges: [], reason: "조건으로 확인한 후보", factLabel: "지도 정보", evidenceUrls: [], groupId: "cafe" }));
  mocks.prepare.mockResolvedValue({ state: completeState(), preferences, needsArea: false, needsSpan: false });
  mocks.explore.mockResolvedValue({ groups: [{ id: "cafe", title: "카페 후보", description: "확인한 후보", cards, needIds: [], availableCount: cardCount }],
    experiencePlan: null, researchPlan: explorationResearchPlan(null, preferences, "성수"), sessionCandidates: null });
  return cards;
}
async function openExploration(cardCount = 1) {
  mockExploration(cardCount);
  render(createElement(AIPlanEditor, editorProps({ candidateExplorationActive: true })));
  send("성수 카페");
  fireEvent.click(await screen.findByRole("button", { name: "선택 완료 · 장소 찾기" }));
  return await screen.findAllByRole("button", { name: "장소 선택", exact: true });
}

it("keeps every selection when eleven places are chosen in one render and sends all of them to planning", async () => {
  const buttons = await openExploration(11);
  mocks.choices.mockResolvedValueOnce({ planningSessionId: "test-session" });
  act(() => { buttons.forEach(button => fireEvent.click(button)); });
  expect(screen.getByText("선택한 장소 11곳")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "선택 취소", exact: true })).toHaveLength(11);
  fireEvent.click(screen.getByRole("button", { name: "선택한 장소로 일정 짜기" }));
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(1));
  const ids = Array.from({ length: 11 }, (_, index) => `kakao:${index + 1}`);
  expect(mocks.choices.mock.calls[0][0].selectedIds).toEqual(ids);
  expect(mocks.recommend.mock.calls[0][0].planningInput.selectedCandidateIds).toEqual(ids);
  expect(screen.queryByText(/선택한 장소를 줄여/)).toBeNull();
});

it("retains a natural-language candidate refinement on failure", async () => {
  await openExploration();
  mocks.explore.mockResolvedValueOnce({ error: "일시적인 조회 오류" });
  const composer = send("다른 카페 더 보여줘");
  await screen.findByText("후보를 불러오지 못했어요. 다시 시도해 주세요.");
  await waitFor(() => expect(composer).toHaveProperty("disabled", false));
  expect(composer.value).toBe("다른 카페 더 보여줘");
});

it("releases candidate loading when selection verification fails, so it can be retried", async () => {
  const [select] = await openExploration();
  mocks.choices.mockResolvedValueOnce(null).mockResolvedValueOnce({ planningSessionId: "test-session" });
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("button", { name: "선택한 장소로 일정 짜기" }));
  await screen.findByText("선택한 장소를 확인하지 못했어요. 다시 선택하거나 잠시 후 시도해 주세요.");
  const retry = screen.getByRole("button", { name: "선택한 장소로 일정 짜기" });
  expect(retry).toHaveProperty("disabled", false);
  expect(mocks.recommend).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "AI 플래너에게 메시지" })).toHaveProperty("disabled", false));
  expect(mocks.recommend.mock.calls[0][0].planningInput.selectedCandidateIds).toEqual(["kakao:1"]);
});

it("reports replacement failure while retaining the user's rejected-place feedback", async () => {
  await openExploration();
  mocks.replaceRejected.mockResolvedValueOnce({ error: "일시적인 조회 오류" });
  fireEvent.click(screen.getByRole("button", { name: "별로예요" }));
  await screen.findByText("이 장소는 제외했어요. 새 후보를 불러오지 못했으니 ‘다른 곳 보기’로 다시 찾아 주세요.");
  expect(screen.queryByText("후보 1", { exact: true })).toBeNull();
  expect(screen.getByRole("button", { name: "다른 카페 보기" })).toHaveProperty("disabled", false);
});

it("plans the selected candidates from a natural-language request without searching again", async () => {
  const [select] = await openExploration();
  mocks.choices.mockResolvedValue({ planningSessionId: "test-session" });
  fireEvent.click(select);
  send("선택한 장소로 일정 짜줘");
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(1));
  expect(mocks.explore).toHaveBeenCalledTimes(1);
  expect(mocks.recommend.mock.calls[0][0].planningInput.selectedCandidateIds).toEqual(["kakao:1"]);
});

it("answers candidate questions using every visible venue, instead of repeating the search", async () => {
  await openExploration(11);
  send("11번 카페 주소 알려줘");
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(1));
  expect(mocks.explore).toHaveBeenCalledTimes(1);
  const input = mocks.recommend.mock.calls[0][0];
  expect(input.shownStops).toHaveLength(11);
  expect(input.shownStops[10]).toMatchObject({ name: "후보 11", address: "서울 성동구" });
  expect(input.previousState.shownPlaces[10]).toBe("후보 11");
  expect(input.planningInput).toBeUndefined();
});

it("selects explicitly numbered places and plans them together without searching again", async () => {
  await openExploration(11);
  mocks.choices.mockResolvedValue({ planningSessionId: "test-session" });
  send("1번 2번 3번 4번 10번 11번으로 일정 짜줘");
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(1));
  expect(mocks.recommend.mock.calls[0][0].planningInput.selectedCandidateIds)
    .toEqual(["kakao:1", "kakao:2", "kakao:3", "kakao:4", "kakao:10", "kakao:11"]);
  expect(mocks.explore).toHaveBeenCalledTimes(1);
});

it("applies a changed region and invalidates the old signed shortlist and selected places", async () => {
  const [select] = await openExploration();
  fireEvent.click(select);
  mocks.prepare.mockResolvedValueOnce({ state: { ...completeState(), areas: ["제주"], region: "제주" },
    preferences, needsArea: false, needsSpan: false });
  send("제주로 변경해줘");
  await screen.findByText("지역과 조건을 변경하고 이전 장소 선택을 비웠어요. 원하는 종류를 고르면 새 후보를 찾을 수 있어요.");
  expect(screen.queryByText("선택한 장소 1곳")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "선택 완료 · 장소 찾기" }));
  await screen.findByText("선택한 장소 0곳");
  const request = mocks.explore.mock.calls[1][0];
  expect(request.state.areas).toEqual(["제주"]);
  expect(request.sessionCandidates).toBeNull();
  expect(request.selectedIds).toEqual([]);
});

it("preserves the chosen venues while applying new start time conditions", async () => {
  const [select] = await openExploration();
  fireEvent.click(select);
  const updatedState = { ...completeState(), startTime: "15:00" };
  mocks.prepare.mockResolvedValueOnce({ state: updatedState, preferences, needsArea: false, needsSpan: false });
  send("오후 3시부터 시작할게");
  await screen.findByText("새 조건을 반영했어요. 선택한 장소는 유지했어요. 후보를 다시 확인한 뒤 일정을 만들어 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "선택 완료 · 장소 찾기" }));
  await screen.findByText("선택한 장소 1곳");
  expect(mocks.explore.mock.calls[1][0]).toMatchObject({ state: { startTime: "15:00" }, selectedIds: ["kakao:1"] });
});

it("keeps the explicit new pace in both the brief and the candidate preferences", async () => {
  const [select] = await openExploration();
  fireEvent.click(select);
  mocks.prepare.mockResolvedValueOnce({ state: { ...completeState(), pace: "relaxed" }, preferences,
    needsArea: false, needsSpan: false });
  send("일정은 더 여유롭게");
  await screen.findByText("새 조건을 반영했어요. 선택한 장소는 유지했어요. 후보를 다시 확인한 뒤 일정을 만들어 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "선택 완료 · 장소 찾기" }));
  await screen.findByText("선택한 장소 1곳");
  expect(mocks.explore.mock.calls[1][0]).toMatchObject({ state: { pace: "relaxed" },
    preferences: { pace: "relaxed", provenance: { pace: "explicit_text" } }, selectedIds: ["kakao:1"] });
});

it("preserves all existing conditions and selections if global-condition intake fails", async () => {
  const [select] = await openExploration();
  fireEvent.click(select);
  mocks.prepare.mockRejectedValueOnce(new Error("network"));
  const composer = send("제주로 변경해줘");
  await screen.findByText("조건을 변경하지 못했어요. 기존 조건과 장소 선택은 유지했어요. 잠시 후 다시 보내 주세요.");
  expect(composer).toHaveProperty("value", "제주로 변경해줘");
  expect(screen.getByText("선택한 장소 1곳")).toBeTruthy();
  expect(screen.getByRole("button", { name: "선택 취소", exact: true })).toBeTruthy();
  expect(mocks.explore).toHaveBeenCalledTimes(1);
});

it("invalidates a planned course when its candidate selection changes, preventing a stale save", async () => {
  const [select] = await openExploration(2);
  mocks.choices.mockResolvedValue({ planningSessionId: "test-session" });
  mocks.recommend.mockResolvedValueOnce({ result: plan(), sessionCandidates: null });
  fireEvent.click(select);
  fireEvent.click(screen.getByRole("button", { name: "선택한 장소로 일정 짜기" }));
  await screen.findByRole("button", { name: "이 코스 담기" });
  fireEvent.click(screen.getByRole("button", { name: "장소 선택", exact: true }));
  expect(screen.queryByRole("button", { name: "이 코스 담기" })).toBeNull();
  expect(screen.getByText("선택한 장소 2곳")).toBeTruthy();
  expect(screen.getByRole("button", { name: "선택한 장소로 일정 짜기" })).toHaveProperty("disabled", false);
  expect(screen.getByText("선택이나 탐색 조건이 달라졌어요. 선택한 장소로 일정을 다시 만들면 변경 사항을 반영할 수 있어요.")).toBeTruthy();
});

it("does not turn missing route measurements into a misleading zero-meter total", async () => {
  mocks.recommend.mockResolvedValueOnce({ result: plan(), sessionCandidates: null });
  render(createElement(AIPlanEditor, editorProps()));
  send("성수 코스");
  await screen.findByRole("button", { name: "이 코스 담기" });
  expect(screen.queryByText(/직선 0m/)).toBeNull();
});

it("uses the engine's verified walking distance rather than summing estimated card distances", async () => {
  mocks.recommend.mockResolvedValueOnce({ result: { ...plan(), design: { theme: "도보 코스", alternativesConsidered: 1,
    routeBasis: "walking", totalDistanceMeters: 2800, evidenceCount: 0, degraded: false } }, sessionCandidates: null });
  render(createElement(AIPlanEditor, editorProps()));
  send("성수 도보 코스");
  await screen.findByRole("button", { name: "이 코스 담기" });
  expect(screen.getByText("1곳 · 도보 경로 2.8km")).toBeTruthy();
});
