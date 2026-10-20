import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { chatSituationFromMessage, composeDateChat, dateChatCard, looksPolite } from "./composeDateChat";
import { completeJson } from "./client";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("composeDateChat", () => {
  it("asks for the missing destination without a model round trip", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const card = await composeDateChat({ situation: "need_area", userMessage: "여행 가고 싶어",
      state: emptyDateBrief() });
    expect(card.headline).toBe("어디로 떠날까요?");
    expect(completeJson).not.toHaveBeenCalled();
  });

  it.each(["greeting", "capability"] as const)("answers an initial %s without waiting for a provider", async situation => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const card = await composeDateChat({ situation, userMessage: situation === "greeting" ? "안녕하세요" : "뭐 할 수 있어",
      state: emptyDateBrief() });
    expect(card.lines.length).toBeGreaterThan(0);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("does not treat plan requests as capability talk", () => {
    expect(chatSituationFromMessage("을지로에서 뭘 해")).toBeNull();
    expect(chatSituationFromMessage("맛집 소개해줘")).toBeNull();
    expect(chatSituationFromMessage("도움 되는 카페")).toBeNull();
    expect(chatSituationFromMessage("뭐 할 수 있어")).toBe("capability");
    expect(chatSituationFromMessage("안녕하세요")).toBe("greeting");
  });

  it("distinguishes thanks from an actual follow-up and recognizes feedback", () => {
    expect(chatSituationFromMessage("고마워요")).toBe("thanks");
    expect(chatSituationFromMessage("고마워, 카페도 추천해줘")).toBeNull();
    expect(chatSituationFromMessage("고마워, 2번 카페 주차 돼?")).toBeNull();
    expect(chatSituationFromMessage("이 코스 별로야")).toBe("feedback");
    expect(chatSituationFromMessage("이 코스 별로야. 식당 바꿔줘")).toBeNull();
  });

  it("asks for a specific correction while preserving an existing course", () => {
    const card = dateChatCard({
      situation: "feedback",
      userMessage: "이 코스 별로야",
      state: emptyDateBrief(),
      extras: { currentCourse: ["식당 A", "카페 B"] },
    });
    expect(card.lines.join(" ")).toContain("나머지 장소는 유지");
    expect(card.suggestions).toContain("동선을 고쳐줘");
  });

  it("offers a fresh candidate list after place feedback without a course", () => {
    const state = { ...emptyDateBrief(), shownPlaces: ["카페 A", "카페 B"] };
    const card = dateChatCard({ situation: "feedback", userMessage: "이 추천 별로야", state });
    expect(card.suggestions).toContain("다른 곳 더 보여줘");
    expect(card.suggestions).not.toContain("식당을 바꿔줘");
  });

  it("explains what it can do without rating disclaimers", () => {
    const card = dateChatCard({
      situation: "capability",
      userMessage: "뭐 할 수 있어",
      state: emptyDateBrief(),
    });
    expect(card.headline).toContain("코스");
    expect(card.lines.join(" ")).toContain("변경 해줘");
    expect(card.lines.join(" ")).not.toContain("별점");
    expect(card.lines.join(" ")).not.toContain("분위기");
  });

  it("rejects 반말 model replies so the card fallback is used", () => {
    expect(looksPolite("안녕하세요. 동네를 말해 주시면 코스를 짜 드릴게요.")).toBe(true);
    expect(looksPolite("어디로 갈까요?")).toBe(true);
    expect(looksPolite("안녕! 성수에서 멋진 데이트 코스를 만들어줄게.")).toBe(false);
    expect(looksPolite("시작해보는 건 어때")).toBe(false);
  });

  it("keeps a focused model follow-up for specific feedback instead of generic correction chips", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.mocked(completeJson).mockResolvedValue({ reply: "두 분이 대화하려는 데이트인데 이동이 길게 느껴지셨군요. 어느 구간이 가장 부담스러웠는지 알려 주시면 다음 변경에 반영할 수 있어요.",
      suggestions: ["도보 이동 줄여줘"] });
    const card = await composeDateChat({ situation: "feedback", userMessage: "대화할 시간보다 이동이 너무 길어",
      state: { ...emptyDateBrief(), areas: ["성수"] }, extras: { currentCourse: ["식당 A", "카페 B"] } });
    expect(card.lines.join(" ")).toContain("대화하려는 데이트");
    expect(card.suggestions).toEqual(["도보 이동 줄여줘"]);
    expect(completeJson).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: "low",
      timeoutMs: 8000, retryOnTruncation: false }));
  });

  it("does not truncate a contextual answer at 400 characters or discard a deliberate no-chip reply", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const reply = `${"요청하신 상황을 이해하고 두 분의 이동과 대화 시간을 함께 생각해 볼 수 있어요. ".repeat(12)}필요하실 때 이어서 도와드릴게요.`;
    vi.mocked(completeJson).mockResolvedValue({ reply, suggestions: [] });
    const card = await composeDateChat({ situation: "unclear", userMessage: "아까 얘기한 조건을 어떻게 해석한 거야", state: emptyDateBrief() });
    expect(card.lines).toEqual([reply]);
    expect(card.suggestions).toEqual([]);
  });
});
