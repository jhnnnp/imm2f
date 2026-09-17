import { describe, expect, it } from "vitest";
import { emptyDateBrief, missingSlot } from "@/features/ai/dateBrief";
import { applyInterpretPatch, fallbackPatch, mergeDateState, shouldSkipDateNlu } from "./interpretDateRequest";

describe("interpretDateRequest local merge", () => {
  it("skips NLU only for greetings, not for named destinations", () => {
    expect(shouldSkipDateNlu("안녕하세요")).toBe(true);
    expect(shouldSkipDateNlu("성수에서 데이트하고 싶어")).toBe(false);
    expect(shouldSkipDateNlu("판교 여행 코스 짜줘")).toBe(false);
    expect(shouldSkipDateNlu("을지로에서 뭘 해")).toBe(false);
    expect(shouldSkipDateNlu("맛집 소개해줘")).toBe(false);
    expect(shouldSkipDateNlu("뭐 할 수 있어")).toBe(true);
    expect(shouldSkipDateNlu("너는 누구야")).toBe(true);
  });

  it("does not invent cafe+meal+walk from a destination-only message", () => {
    const local = fallbackPatch("성수에서 데이트하고 싶어");
    const merged = mergeDateState(undefined, local);
    expect(merged.areas).toContain("성수");
    expect(merged.activities).toEqual([]);
    expect(merged.stayKind).toBe("date");
    expect(missingSlot(merged)).toBe("time");
  });

  it("keeps LLM activities instead of unioning regex false positives", () => {
    const result = applyInterpretPatch({
      message: "성수에서 전시 보고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["exhibit"], intent: "create" },
    });
    expect(result.state.activities).toEqual(["exhibit"]);
    expect(result.state.areas).toContain("성수");
  });

  it("asks for an area when the user wants a date with no place", () => {
    const result = applyInterpretPatch({
      message: "데이트하고 싶어",
      patch: fallbackPatch("데이트하고 싶어"),
    });
    expect(result.slot).toBe("area");
    expect(result.state.areas).toEqual([]);
    expect(result.state.stayKind).toBe("date");
  });

  it("reads overnight length from 1박2일 and does not ask the time slot", () => {
    const result = applyInterpretPatch({
      message: "군산에 여행가면서 놀고싶어 1박2일 일정으로",
      patch: fallbackPatch("군산에 여행가면서 놀고싶어 1박2일 일정으로"),
    });
    expect(result.state.areas).toContain("군산");
    expect(result.state.stayKind).toBe("overnight");
    expect(result.state.nights).toBe(1);
    expect(result.slot).toBeNull();
  });
});
