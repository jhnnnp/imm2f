import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { chatSituationFromMessage, dateChatCard, looksPolite } from "./composeDateChat";

describe("composeDateChat", () => {
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
});
