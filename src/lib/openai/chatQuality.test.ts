import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { composeDateChat } from "./composeDateChat";
import { answerDateQuestion, resolveQuestionFocus } from "./answerDateQuestion";
import { cleanChatSuggestions, claimsUnperformedAction } from "./chatPresentation";

vi.mock("./client", () => ({ completeJson: vi.fn(), completeJsonWithWebSearch: vi.fn() }));
const state = emptyDateBrief();
const stops = [{ name: "식당 A", meta: "식당", startTime: "14:00", durationMinutes: 60 },
  { name: "카페 B", meta: "카페", startTime: "16:30", durationMinutes: 90, openingHours: "10:00–22:00" }];
const questionInput = { state, stops, coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] } };
beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "mock-only"));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("keeps every chosen and shown venue in conversational context beyond eight places", async () => {
  const names = Array.from({ length: 16 }, (_, index) => `선택 장소 ${index + 1}`);
  vi.mocked(completeJson).mockResolvedValue({ reply: "선택한 장소를 모두 참고해서 도와드릴게요.", suggestions: [] });
  await composeDateChat({ situation: "thanks", userMessage: "고마워요", state: { ...state, shownPlaces: names },
    extras: { currentCourse: names } });
  const chatPayload = JSON.parse(vi.mocked(completeJson).mock.lastCall![0].messages[1].content as string);
  expect(chatPayload.currentCourse).toEqual(names);
  expect(chatPayload.shownPlaces).toEqual(names);
  const shownStops = names.map(name => ({ name, meta: "카페" }));
  await answerDateQuestion({ ...questionInput, message: "이 후보들의 동선은 어때?", shownStops });
  const questionPayload = JSON.parse(vi.mocked(completeJson).mock.lastCall![0].messages[1].content as string);
  expect(questionPayload.lastShownPlaces).toEqual(shownStops);
});

it.each(["예약을 완료했어요.", "카페 예약해 드렸어요.", "결제가 완료됐어요.", "일정이 저장되었습니다.", "카페를 코스에 넣었어요.", "코스를 바꿨습니다.", "일정을 수정했어요.", "카페를 교체해 뒀어요."])("rejects false action confirmation: %s", async reply => {
  vi.mocked(completeJson).mockResolvedValue({ reply, suggestions: [] });
  const card = await composeDateChat({ situation: "thanks", userMessage: "고마워요", state });
  expect(card.headline).toBe("도움이 됐다니 다행이에요");
  expect(card.lines).not.toContain(reply);
});

it.each(["예약은 직접 확인해 주세요.", "코스를 바꿔 볼까요?", "예약하지 않았어요.", "영업시간을 확인할 수 있어요."])("allows advice without claiming an action: %s", reply => {
  expect(claimsUnperformedAction(reply)).toBe(false);
});

it("rejects object, number, multiline, and duplicate provider chips", () => {
  expect(cleanChatSuggestions([{}, 7, "카페\n추천해줘", "  카페 추천해줘! ", "카페 추천해줘", "x".repeat(19)]))
    .toEqual(["카페 추천해줘"]);
  expect(cleanChatSuggestions([null, {}], ["코스 짜줘"])).toEqual(["코스 짜줘"]);
});

it.each(["2번 몇 시에 가?", "2번은 몇 시야?", "코스 2번 방문 시간 알려줘"])("answers visit time from the course without searching: %s", async message => {
  const card = await answerDateQuestion({ ...questionInput, message, shownStops: [{ name: "다른 후보", meta: "카페" }] });
  expect(card.headline).toBe("카페 B");
  expect(card.lines.join(" ")).toContain("16:30");
  expect(card.lines.join(" ")).not.toContain("10:00");
  expect(completeJson).not.toHaveBeenCalled();
  expect(completeJsonWithWebSearch).not.toHaveBeenCalled();
});

it("answers course start and known duration without a provider", async () => {
  expect((await answerDateQuestion({ ...questionInput, message: "일정 언제 시작해?" })).lines.join(" ")).toContain("14:00");
  expect((await answerDateQuestion({ ...questionInput, message: "2번 얼마나 머물러?" })).lines.join(" ")).toContain("90분");
  expect(completeJson).not.toHaveBeenCalled();
  expect(completeJsonWithWebSearch).not.toHaveBeenCalled();
});

it("continues to answer actual shop opening hours separately", async () => {
  expect((await answerDateQuestion({ ...questionInput, message: "2번 몇 시에 열어?" })).lines.join(" ")).toContain("10:00–22:00");
  expect(completeJsonWithWebSearch).not.toHaveBeenCalled();
});

it("does not turn a three-digit ordinal into an existing place", () => {
  expect(resolveQuestionFocus("101번 주소", stops)).toMatchObject({ stops: [], invalid: true, explicit: true });
});

it("rejects invented booking confirmation even when web search returns a cited source", async () => {
  vi.mocked(completeJsonWithWebSearch).mockImplementation(async args => {
    args.onSources?.(["https://example.com/venue"]);
    return { reply: "카페 예약을 완료했어요.", sourceUrl: "https://example.com/venue" } as never;
  });
  const card = await answerDateQuestion({ ...questionInput, message: "2번 예약 필요해?" });
  expect(card.lines.join(" ")).toContain("확인하지 못했어요");
  expect(card.sources).toBeUndefined();
});

it("keeps valid grounded advice and cleans its follow-up chips", async () => {
  vi.mocked(completeJson).mockResolvedValue({ reply: "두 장소가 가까워서 식사 후 카페로 이어가면 좋아요.", suggestions: [{ bad: true }, "더 여유롭게!", "더 여유롭게"] });
  const card = await answerDateQuestion({ ...questionInput, message: "이 순서 어때?" });
  expect(card.lines).toEqual(["두 장소가 가까워서 식사 후 카페로 이어가면 좋아요."]);
  expect(card.suggestions).toEqual(["더 여유롭게"]);
});
