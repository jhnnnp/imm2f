import { describe, expect, it } from "vitest";
import { emptyDateBrief, missingSlot } from "@/features/ai/dateBrief";
import { applyInterpretPatch, fallbackPatch, mergeDateState, shouldSkipDateNlu, shouldUseLocalInterpret, validateIntentPayload } from "./interpretDateRequest";

describe("interpretDateRequest local merge", () => {
  it("rejects an area invented from the user's colloquial verb", () => {
    const result = applyInterpretPatch({ message: "부산 여행가려구",
      patch: { addAreas: ["부산", "여행가려구"], intent: "create" } });
    expect(result.state.areas).toEqual(["부산"]);
  });
  it("does not let a model turn an unspecified trip into a day trip", () => {
    const result = applyInterpretPatch({ message: "부산 여행가려구",
      patch: { addAreas: ["부산"], stayKind: "daytrip", nights: 0, intent: "create" } });
    expect(result.state.areas).toEqual(["부산"]);
    expect(result.state.stayKind).toBeNull();
    expect(result.slot).toBe("span");
  });
  it("retains preferences when replacing the course, but releases the old venue pins", () => {
    const previous = { ...emptyDateBrief(), areas: ["왕십리"], cuisine: "일식" as const, activities: ["meal", "cafe"] as const, timeWindow: "evening" as const, requiredPlaces: ["식당 A"], pinOrder: ["식당 A"], budgetWon: 70000 };
    const next = mergeDateState({ ...previous, activities: [...previous.activities] }, { intent: "create", preserveExistingPlaces: false });
    expect(next.cuisine).toBe("일식");
    expect(next.activities).toEqual(["meal", "cafe"]);
    expect(next.timeWindow).toBe("evening");
    expect(next.budgetWon).toBe(70000);
    expect(next.requiredPlaces).toEqual([]);
    expect(next.pinOrder).toEqual([]);
  });

  it.each([{ addAreas: "성수" }, { addPlaces: [null] }, { indoorPlay: {} }, { preserveExistingPlaces: "false" }, { nights: "2" }])("rejects malformed intent data %j", value => {
    expect(validateIntentPayload(value)).toBeNull();
  });

  it("ignores null optional fields without erasing prior constraints", () => {
    expect(validateIntentPayload({ addAreas: [" 성수 "], cuisine: null, preserveExistingPlaces: true })).toEqual({ addAreas: ["성수"], preserveExistingPlaces: true });
  });
  it("does not store the JSON schema's objective placeholder", () => {
    expect(validateIntentPayload({ objective: "short Korean date goal" })).toEqual({});
  });
  it("skips NLU only for greetings, not for named destinations", () => {
    expect(shouldSkipDateNlu("안녕하세요")).toBe(true);
    expect(shouldSkipDateNlu("성수에서 데이트하고 싶어")).toBe(false);
    expect(shouldSkipDateNlu("판교 여행 코스 짜줘")).toBe(false);
    expect(shouldSkipDateNlu("을지로에서 뭘 해")).toBe(false);
    expect(shouldSkipDateNlu("맛집 소개해줘")).toBe(false);
    expect(shouldSkipDateNlu("뭐 할 수 있어")).toBe(true);
    expect(shouldSkipDateNlu("너는 누구야")).toBe(true);
    expect(shouldUseLocalInterpret("성수에서 데이트하고 싶어")).toBe(false);
    expect(shouldUseLocalInterpret("포천 여행 짜줘")).toBe(false);
    expect(shouldUseLocalInterpret("포천 산정호수 가고싶어")).toBe(false);
    expect(shouldUseLocalInterpret("추가해줘", emptyDateBrief())).toBe(false);
    expect(shouldUseLocalInterpret("한 곳 더 추가해줘", emptyDateBrief())).toBe(false);
    expect(shouldUseLocalInterpret("일정추가", emptyDateBrief())).toBe(false);
    expect(shouldUseLocalInterpret("밥 먹을 데도 있으면 좋겠어", emptyDateBrief())).toBe(false);
  });

  it("does not lock a mix on a destination-only message", () => {
    const local = fallbackPatch("성수에서 데이트하고 싶어");
    const merged = mergeDateState(undefined, local);
    expect(merged.areas).toContain("성수");
    expect(merged.activities).toEqual([]);
    expect(merged.stayKind).toBe("date");
    expect(missingSlot(merged)).toBeNull();
  });

  it("ignores guessed mixes and keeps named activities", () => {
    const mix = applyInterpretPatch({
      message: "성수에서 데이트하고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["cafe", "walk", "exhibit"], stayKind: "date", intent: "create" },
    });
    expect(mix.state.activities).toEqual([]);
    const cafeOnly = applyInterpretPatch({
      message: "성수에서 데이트하고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["cafe"], stayKind: "date", intent: "create" },
    });
    expect(cafeOnly.state.activities).toEqual([]);
    const tourismMix = applyInterpretPatch({
      message: "성수에서 데이트하고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["meal", "walk", "exhibit"], stayKind: "date", intent: "create" },
    });
    expect(tourismMix.state.activities).toEqual([]);
  });

  it("does not turn an open dinner request into a model-guessed cuisine", () => {
    const result = applyInterpretPatch({
      message: "왕십리에서 저녁 먹고 예쁜 카페와 공연을 보고 싶어",
      patch: { addAreas: ["왕십리"], addActivities: ["meal", "cafe"], cuisine: "한식", intent: "create" },
    });
    expect(result.state.cuisine).toBeNull();
    expect(result.state.activities).toEqual(expect.arrayContaining(["meal", "cafe", "performance"]));
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

  it("treats 성수 갈래 as a neighborhood date and does not ask stay length", () => {
    const result = applyInterpretPatch({
      message: "성수 갈래",
      patch: fallbackPatch("성수 갈래"),
    });
    expect(result.state.areas).toContain("성수");
    expect(result.state.stayKind).toBe("date");
    expect(result.slot).toBeNull();
  });

  it("keeps the user's follow-up wording and flags an extra stop for the judge", () => {
    const previous = applyInterpretPatch({
      message: "왕십리 데이트",
      patch: fallbackPatch("왕십리 데이트"),
    }).state;
    const typed = applyInterpretPatch({
      message: "밥 먹을 데도 있으면 좋겠어",
      previousState: previous,
      patch: {
        intent: "modify",
        preserveExistingPlaces: true,
        addStop: true,
        conversationNote: "밥 먹을 데도 있으면 좋겠어",
      },
    });
    expect(shouldUseLocalInterpret("밥 먹을 데도 있으면 좋겠어", previous)).toBe(false);
    expect(typed.state.addStop).toBe(true);
    expect(typed.state.preserveExistingPlaces).toBe(true);
    expect(typed.state.conversationNotes.at(-1)).toBe("밥 먹을 데도 있으면 좋겠어");
    const chip = applyInterpretPatch({
      message: "일정추가",
      previousState: previous,
      patch: fallbackPatch("일정추가"),
    });
    expect(chip.state.addStop).toBe(true);
    expect(chip.state.conversationNotes.at(-1)).toBe("일정추가");
    expect(fallbackPatch("추가해줘").addStop).toBe(true);
    expect(fallbackPatch("추가해줘").conversationNote).toBe("추가해줘");
    expect(fallbackPatch("조금 다르게").preserveExistingPlaces).toBe(false);
  });
});
