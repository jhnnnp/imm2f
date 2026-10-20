import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { pickedShownPlaces, routeDateChatLocally } from "@/features/ai/chatRoute";
import { completeJson } from "./client";
import { dateChatRouteSchema, routeDateChat } from "./routeDateChat";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
const input = { hasCourse: true, currentCourse: ["식당 A", "카페 B", "공원 C"], state: emptyDateBrief() };
beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "mock-only"));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it.each(["1번 빼줘", "1번을 제외해줘", "1번 삭제해줘"])("grounds exact removal without another model call: %s", async message => {
  expect(await routeDateChat({ ...input, message })).toMatchObject({ mode: "course", edit: { kind: "remove", indices: [1] } });
  expect(completeJson).not.toHaveBeenCalled();
});

it("preserves the exact requested reorder and all original stops", async () => {
  expect(await routeDateChat({ ...input, message: "3번, 2번, 1번 순서로 바꿔줘" })).toMatchObject({ edit: { kind: "reorder", indices: [3, 2, 1] } });
  expect(completeJson).not.toHaveBeenCalled();
});

it.each(["9번 빼줘", "101번 제외해줘"])("clarifies an absent removal target: %s", async message => {
  expect(await routeDateChat({ ...input, message })).toMatchObject({ mode: "question" });
  expect(completeJson).not.toHaveBeenCalled();
});

it.each([[1, 999], [1, 1], ["1"], null])("rejects a partial or invalid model edit instead of silently filtering it: %j", async indices => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: { kind: "remove", indices } });
  expect(await routeDateChat({ ...input, message: "음 그렇게 해줘" })).toMatchObject({ mode: "question" });
});

it("rejects an incomplete reorder instead of deleting the remaining stops", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: { kind: "reorder", indices: [2, 1] } });
  expect(await routeDateChat({ ...input, message: "음 그렇게 해줘" })).toMatchObject({ mode: "question" });
});

it("does not interpret a discussion as a removal command", async () => {
  expect(await routeDateChat({ ...input, message: "1번 빼도 될까?" })).toMatchObject({ mode: "question" });
  expect(completeJson).not.toHaveBeenCalled();
});

it("rejects a hallucinated deletion for an opaque acknowledgement", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: { kind: "remove", indices: [1] } });
  expect(await routeDateChat({ ...input, message: "응 그렇게" })).toMatchObject({ mode: "question" });
});

it("preserves an explicitly protected place while removing only the requested one", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: { kind: "remove", indices: [1] } });
  expect(await routeDateChat({ ...input, message: "1번 빼지 말고 2번 빼줘" })).toMatchObject({ mode: "question" });
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: { kind: "remove", indices: [2] } });
  expect(await routeDateChat({ ...input, message: "1번 빼지 말고 2번 빼줘" })).toMatchObject({ edit: { indices: [2] } });
});

it("does not silently delete both alternatives", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: { kind: "remove", indices: [1, 2] } });
  expect(await routeDateChat({ ...input, message: "1번 또는 2번 중 하나 빼줘" })).toMatchObject({ mode: "question" });
});

it("does not execute a conditional removal before its condition is checked", async () => {
  expect(await routeDateChat({ ...input, message: "1번이 너무 멀면 빼줘" })).toMatchObject({ mode: "question" });
  expect(completeJson).not.toHaveBeenCalled();
});

it("supports the fourth and last candidates but does not wrap a large number", () => {
  const shown = ["카페 A", "카페 B", "카페 C", "카페 D"];
  expect(pickedShownPlaces("네 번째로 코스", shown)).toEqual(["카페 D"]);
  expect(pickedShownPlaces("마지막으로 코스", shown)).toEqual(["카페 D"]);
  expect(pickedShownPlaces("101번으로 코스", shown)).toEqual([]);
  expect(routeDateChatLocally({ message: "101번으로 코스 짜줘", hasCourse: false, state: { ...input.state, shownPlaces: shown }, chatSituation: null }).mode).toBe("question");
});

it("lets semantic reasoning interpret a confident local place request and its constraints", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "places", placeKind: "cafe", area: "성수",
    query: "예약 없이 대화하기 좋은 카페", pickedPlaces: [], edit: null });
  const result = await routeDateChat({ ...input, message: "성수에서 예약 없이 들어가서 둘이 이야기 나누기 좋은 카페 찾아줘" });
  expect(result).toMatchObject({ mode: "places", placeAsk: { kind: "cafe", query: "예약 없이 대화하기 좋은 카페", area: "성수" } });
  const request = vi.mocked(completeJson).mock.calls[0][0];
  expect(request.jsonSchema?.schema).toEqual(dateChatRouteSchema);
  expect(request.reasoningEffort).toBe("low");
});

it("uses conversation meaning for a follow-up without requiring a canned course keyword", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", edit: null, pickedPlaces: [] });
  const conversation = [{ role: "user" as const, text: "성수에서 저녁 먹고 이야기 나누고 싶어" },
    { role: "assistant" as const, text: "식사 뒤 카페에 들르는 흐름으로 준비해 볼까요?" }];
  expect(await routeDateChat({ ...input, message: "말한 방식으로 준비해줘", conversation })).toMatchObject({ mode: "course" });
  const payload = JSON.parse(vi.mocked(completeJson).mock.calls[0][0].messages[1].content);
  expect(payload.recentTurns).toEqual(conversation);
});

it("does not generate an itinerary from an empty message", async () => {
  expect(await routeDateChat({ ...input, message: "  " })).toMatchObject({ mode: "chat" });
  expect(completeJson).not.toHaveBeenCalled();
});

it.each(["안녕하세요", "고마워요", "뭐 할 수 있어?"])("handles a self-contained conversation without model routing: %s", async message => {
  expect(await routeDateChat({ message, hasCourse: false, currentCourse: [] })).toMatchObject({ mode: "chat" });
  expect(completeJson).not.toHaveBeenCalled();
});

it("routes an exact destination intake choice locally", async () => {
  expect(await routeDateChat({ message: "성수", hasCourse: false, currentCourse: [],
    state: { ...emptyDateBrief(), pendingSlot: "area" } })).toMatchObject({ mode: "course" });
  expect(completeJson).not.toHaveBeenCalled();
});

it("rejects an absent shown candidate before an AI-selected venue can substitute for it", async () => {
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", pickedPlaces: ["카페 A"] });
  expect(await routeDateChat({ message: "101번으로 코스 짜줘", state: { ...input.state, shownPlaces: ["카페 A"] },
    hasCourse: false, currentCourse: [] })).toMatchObject({ mode: "question" });
  expect(completeJson).not.toHaveBeenCalled();
});

it("preserves all five explicitly chosen displayed venues rather than silently dropping the fifth", async () => {
  const shownPlaces = ["카페 A", "식당 B", "전시 C", "공원 D", "바 E"];
  vi.mocked(completeJson).mockResolvedValue({ mode: "course", pickedPlaces: shownPlaces, edit: null });
  const result = await routeDateChat({ message: "1번 2번 3번 4번 5번 모두 넣어서 코스 짜줘",
    hasCourse: false, currentCourse: [], state: { ...input.state, shownPlaces } });
  expect(result.pickedPlaces).toEqual(shownPlaces);
});
