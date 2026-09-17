import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { chatSituationFromMessage, dateChatCard } from "./composeDateChat";

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
});
