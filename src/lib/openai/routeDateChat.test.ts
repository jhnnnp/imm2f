import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { pickedShownPlaces, routeDateChatLocally } from "@/features/ai/chatRoute";
import { completeJson } from "./client";
import { routeDateChat } from "./routeDateChat";

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
