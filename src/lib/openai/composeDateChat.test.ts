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
