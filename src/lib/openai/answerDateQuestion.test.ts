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

  it("uses an assistant-introduced place as the focus of a pronoun follow-up", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const card = await answerDateQuestion({ ...input, message: "그 카페 메뉴는?", conversation: [
      { role: "user", text: "디저트가 있으면 좋겠어" },
      { role: "assistant", text: "디저트를 원하셔서 카페 B를 추천드려요." },
    ] });
    expect(card.headline).toBe("카페 B");
    expect(card.lines.join(" ")).toContain("딸기 케이크");
  });

  it("retains an assistant-named branch without treating its landmark as a second place", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const venues = [{ name: "소월아트홀", meta: "공연장" },
      { name: "할리스 소월아트홀점", meta: "카페", dishes: "치즈케이크" }];
    const card = await answerDateQuestion({ ...input, stops: venues, message: "거기 메뉴는?",
      conversation: [{ role: "assistant", text: "할리스 소월아트홀점을 추천드려요." }] });
    expect(card.headline).toBe("할리스 소월아트홀점");
    expect(card.lines.join(" ")).toContain("치즈케이크");
  });

  it("answers a pronoun follow-up from the latest displayed branch when names match across lists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const card = await answerDateQuestion({ ...input,
      stops: [{ name: "같은 카페", meta: "카페", address: "서울 성수 1", dishes: "성수 지점 메뉴" }],
      shownStops: [{ name: "같은 카페", meta: "카페", address: "서울 강남 2", dishes: "강남 지점 메뉴" }],
      message: "거기 메뉴 알려줘", conversation: [{ role: "assistant", text: "같은 카페를 추천해 드려요." }] });
    expect(card.lines.join(" ")).toContain("강남 지점 메뉴");
    expect(card.lines.join(" ")).not.toContain("성수 지점 메뉴");
  });

  it("clarifies rather than borrowing facts when identical display names refer to two visible branches", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const branches = [{ name: "같은 카페", meta: "카페", address: "서울 성수 1", dishes: "성수 지점 메뉴" },
      { name: "같은 카페", meta: "카페", address: "서울 강남 2", dishes: "강남 지점 메뉴" }];
    const card = await answerDateQuestion({ ...input, stops: branches, shownStops: branches,
      message: "거기 메뉴 알려줘", conversation: [{ role: "assistant", text: "같은 카페를 추천해 드려요." }] });
    expect(card.headline).toBe("어느 장소가 궁금하세요?");
    expect(card.lines.join(" ")).not.toMatch(/성수 지점 메뉴|강남 지점 메뉴/);
  });

  it("asks the model to explain a selection in the user's context instead of repeating a card reason", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.mocked(completeJson).mockResolvedValue({ reply: "대화가 목적이라면 이 카페의 메뉴 정보만으로는 조용한지 판단하기 어려워요. 디저트는 확인되지만 혼잡도는 더 확인하는 편이 좋아요.", suggestions: [] });
    const card = await answerDateQuestion({ ...input, message: "2번 왜 골랐어?",
      state: { ...state, objective: "오랜만에 만나 대화하는 데이트", preferences: { vibe: ["조용한"] } } });
    expect(card.lines.join(" ")).toContain("혼잡도는 더 확인");
    expect(completeJson).toHaveBeenCalledOnce();
    const payload = JSON.parse(vi.mocked(completeJson).mock.calls[0][0].messages[1].content);
    expect(payload.brief.objective).toBe("오랜만에 만나 대화하는 데이트");
  });

  it("allows a truthful reference to a past recommendation while rejecting new action confirmations", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const reply = "디저트를 원하셔서 확인된 딸기 케이크 메뉴를 근거로 추천해 드렸어요.";
    vi.mocked(completeJson).mockResolvedValue({ reply, suggestions: [] });
    expect((await answerDateQuestion({ ...input, message: "2번 왜 추천했어?" })).lines).toEqual([reply]);
    vi.mocked(completeJson).mockResolvedValue({ reply: `${reply} 예약도 완료했어요.`, suggestions: [] });
    expect((await answerDateQuestion({ ...input, message: "2번 왜 추천했어?" })).lines.join(" ")).not.toContain("예약도 완료");
  });

  it("researches both comparison venues and retains only sources actually visited", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.mocked(completeJsonWithWebSearch).mockImplementation(async request => {
      const payload = request.payload as { focusStops: QuestionContextStop[] };
      expect(payload.focusStops.map(stop => stop.name)).toEqual(["카페 B", "카페 C"]);
      request.onSources?.(["https://example.com/b", "https://example.com/c"]);
      return { reply: "카페 B는 전용 주차장이 있다고 안내해요. 카페 C의 주차 여부는 아직 확인하지 못했어요. 차로 이동한다면 현재 근거로는 카페 B를 먼저 고려할 수 있어요.", suggestions: [],
        sourceUrls: ["https://example.com/b", "https://example.com/c"] } as never;
    });
    const card = await answerDateQuestion({ ...input, message: "2번과 3번 중 주차하기 편한 곳을 비교해줘" });
    expect(card.headline).toBe("장소 비교");
    expect(card.sources?.map(source => source.url)).toEqual(["https://example.com/b", "https://example.com/c"]);
    expect(card.lines.join(" ")).toContain("카페 B를 먼저 고려");
    expect(completeJsonWithWebSearch).toHaveBeenCalledOnce();
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("rejects a comparison citation that was not returned by the search", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.mocked(completeJsonWithWebSearch).mockImplementation(async request => {
      request.onSources?.(["https://example.com/b"]);
      return { reply: "카페 B와 카페 C 모두 무료 주차가 가능해요.", sourceUrls: ["https://example.com/b", "https://example.com/invented"] } as never;
    });
    const card = await answerDateQuestion({ ...input, message: "2번과 3번 주차 비교해줘" });
    expect(card.sources).toBeUndefined();
    expect(card.lines.join(" ")).not.toContain("무료 주차");
  });

  it("resolves all mentioned categories for a comparison without treating a first date as ordinal one", () => {
    expect(resolveQuestionFocus("식당과 카페 비교해줘", stops).stops).toEqual(stops);
    expect(resolveQuestionFocus("처음 데이트할 때 어떤 곳이 좋아?", stops)).toMatchObject({ stops: [], explicit: false });
  });
});
