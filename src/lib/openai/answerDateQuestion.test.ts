import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { answerDateQuestion, fallbackQuestionCard, resolveQuestionFocus, type QuestionContextStop } from "./answerDateQuestion";
import { completeJson, completeJsonWithWebSearch } from "./client";

vi.mock("./client", () => ({ completeJson: vi.fn(), completeJsonWithWebSearch: vi.fn() }));
const stops: QuestionContextStop[] = [
  { name: "식당 A", meta: "한식", address: "서울 성동구", reason: "요청하신 한식 식사를 할 수 있어요." },
  { name: "카페 B", meta: "카페", dishes: "딸기 케이크", reason: "디저트를 원하셔서 골랐어요." },
  { name: "카페 C", meta: "카페", openingHours: "10:00–20:00" },
];
const state = emptyDateBrief();
const input = { state, stops, coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] } };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("conversation place references", () => {
  it("uses the exact ordinal rather than appending another cafe", () => {
    expect(resolveQuestionFocus("2번 카페 메뉴 추천해줘", stops).stops.map(s => s.name)).toEqual(["카페 B"]);
    expect(resolveQuestionFocus("11번 영업시간", stops).invalid).toBe(true);
    expect(resolveQuestionFocus("1번과 3번 비교해줘", stops).stops.map(s => s.name)).toEqual(["식당 A", "카페 C"]);
  });
  it("does not confuse a landmark and a branch named after it", () => {
    const venues = [{ name: "소월아트홀", meta: "공연장" }, { name: "할리스 소월아트홀점", meta: "카페" }];
    expect(resolveQuestionFocus("할리스 소월아트홀점 주차 돼?", venues).stops.map(s => s.name)).toEqual(["할리스 소월아트홀점"]);
    expect(resolveQuestionFocus("소월아트홀 주차 돼?", venues).stops.map(s => s.name)).toEqual(["소월아트홀"]);
  });
  it("answers the asked detail during provider failure instead of listing unrelated metadata", () => {
    const parking = fallbackQuestionCard("1번 주차 돼?", stops, state);
    expect(parking.lines.join(" ")).toContain("주차 가능 여부는 아직 확인하지 못했어요");
    expect(parking.lines.join(" ")).not.toContain("서울 성동구");
    expect(fallbackQuestionCard("2번 왜 골랐어?", stops, state).lines).toEqual([stops[1].reason]);
    expect(fallbackQuestionCard("2번 메뉴 알려줘", stops, state).lines.join(" ")).toContain("딸기 케이크");
  });
  it("does not present a rating alone as the reason a cafe fits the request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const card = await answerDateQuestion({ ...input, message: "2번 카페 왜 골랐어?", stops: [stops[0], { ...stops[1], reason: "4.5점 · 후기 49" }] });
    expect(card.headline).toBe("카페 B");
    expect(card.lines.join(" ")).toContain("근거는 아직 충분하지 않아요");
  });
  it("clarifies an ambiguous cafe without choosing the first one", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const card = await answerDateQuestion({ ...input, message: "카페 주차 돼?" });
    expect(card.headline).toBe("어느 장소가 궁금하세요?");
    expect(completeJsonWithWebSearch).not.toHaveBeenCalled();
  });
  it("uses the latest displayed list for ordinals and the course when explicitly requested", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const shownStops = [{ name: "새 카페 D", meta: "카페", dishes: "치즈케이크" }];
    expect((await answerDateQuestion({ ...input, shownStops, message: "1번 메뉴 알려줘" })).headline).toBe("새 카페 D");
    expect((await answerDateQuestion({ ...input, shownStops, message: "코스 1번 주소 알려줘" })).headline).toBe("식당 A");
  });
  it("retains the referenced place across a short follow-up", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const card = await answerDateQuestion({ ...input, message: "거기 메뉴는?", conversation: [{ role: "user", text: "2번은 왜 골랐어?" }] });
    expect(card.headline).toBe("카페 B");
    expect(card.lines.join(" ")).toContain("딸기 케이크");
  });
  it("does not replace a failed live lookup with an ungrounded model answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.mocked(completeJsonWithWebSearch).mockResolvedValue(null);
    const card = await answerDateQuestion({ ...input, message: "2번 주차 돼?" });
    expect(card.headline).toBe("카페 B");
    expect(card.lines.join(" ")).toContain("확인하지 못했어요");
    expect(completeJson).not.toHaveBeenCalled();
  });
});
