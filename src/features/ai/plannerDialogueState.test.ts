import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { validPlannerState, validateDatePlannerInput } from "./plannerInputValidation";
import { hasPlannerOrigin, isPlannerOriginAnswer, resumePlannerDialogue } from "./plannerDialogueState";
import { plannerEntryState } from "./chatEntry";
import { applyInterpretPatch, fallbackPatch } from "@/lib/openai/interpretDateRequest";

describe("pending planner dialogue", () => {
  it.each(["서울고속버스터미널", "서울고속버스터미널에서 출발", "부산 버스정류장에서 출발", "동대구 환승센터", "서울역에서"])
  ("retains an actual departure answer even when its name contains transport words: %s", message => {
    expect(isPlannerOriginAnswer(message)).toBe(true);
  });

  it.each(["버스가 나아?", "서울고속버스터미널에서 출발하면 버스가 나아?", "서울고속버스터미널에서 출발하는 버스 있나", "서울역에서 어떻게 가?", "버스 탈까", "출발지는 아직 미정"])
  ("keeps route questions and unknown origins out of origin answers: %s", message => {
    expect(isPlannerOriginAnswer(message)).toBe(false);
  });

  it.each(["출발지는 아직 미정", "출발지부터 고려한 부산 1박2일 경로", "어디에서 출발할지 몰라", "출발지는 정해지지 않았어"])
  ("does not count a reference to the origin field as a departure place: %s", message => {
    expect(hasPlannerOrigin(message)).toBe(false);
  });

  it.each(["서울역에서 출발", "출발지는 서울 고속버스터미널", "출발지: 대전역", "출발지 서울역", "동대구 환승센터부터 출발"])
  ("recognizes supplied origins without using a fixed location list: %s", message => {
    expect(hasPlannerOrigin(message)).toBe(true);
  });

  it("preserves exact preference text across several answers and idempotent retries", () => {
    const first = "조용한 공간이 좋아. 해산물은 빼고 여행 일정 짜줘";
    let resumed = resumePlannerDialogue([first], "부산", emptyDateBrief());
    resumed = resumePlannerDialogue(resumed.turns, "2박3일", resumed.state);
    expect(resumed.request).toBe(`${first}\n부산\n2박3일`);
    expect(resumePlannerDialogue(resumed.turns, resumed.request, resumed.state).request).toBe(resumed.request);
  });

  it("keeps long earlier instructions in valid state instead of exceeding the 800-character message limit", () => {
    const earlier = "해산물은 빼고 조용한 공간과 긴 산책 대신 가까운 동선을 원해. ".repeat(24).slice(0, 795);
    const result = resumePlannerDialogue([earlier], "부산 2박3일", emptyDateBrief());
    expect(result.request).toBe("부산 2박3일");
    expect(result.state.userRequests).toContain(earlier);
    expect(result.state.conversationNotes).toContain(earlier);
    expect(validPlannerState(result.state)).toBe(true);
    expect(validateDatePlannerInput({ message: result.request, previousState: result.state })).toBeNull();
  });

  it("does not carry a cancelled request into a new plan", () => {
    const result = resumePlannerDialogue(["부산 2박3일"], "새 여행은 제주 당일치기로 짜줘", {
      ...emptyDateBrief(), areas: ["부산"], regions: ["부산"], region: "부산", nights: 2, stayKind: "overnight",
      userRequests: ["부산 2박3일"], conversationNotes: ["조용한 여행"],
    });
    expect(result.request).toBe("새 여행은 제주 당일치기로 짜줘");
    expect(result.state.areas).toEqual([]);
    expect(result.state.nights).toBe(0);
    expect(result.state.userRequests).toEqual([]);
  });

  it("retains explicit allergy restrictions after long intake when the final answer uses the local interpreter fallback", () => {
    const request = "새우 알레르기가 있어. 해산물도 빼줘. 조용하고 가까운 동선의 여행 일정이 좋아. ".repeat(18).slice(0, 798);
    const collected = plannerEntryState({ message: request, state: emptyDateBrief() });
    const resumed = resumePlannerDialogue([request], "부산 2박3일", collected);
    expect(resumed.request).toBe("부산 2박3일");
    const result = applyInterpretPatch({ message: resumed.request, previousState: resumed.state,
      patch: fallbackPatch(resumed.request) });
    expect(result.state.excludedFoods).toEqual(expect.arrayContaining(["새우", "해산물"]));
    expect(result.state.foodAllergy).toBe(true);
  });

  it("does not turn a dislike or an explicitly denied allergy into a medical constraint", () => {
    expect(plannerEntryState({ message: "새우는 싫지만 알레르기는 없어", state: emptyDateBrief() }).foodAllergy).toBe(false);
    const previous = { ...emptyDateBrief(), excludedFoods: ["새우", "해산물"], foodAllergy: true };
    const changed = plannerEntryState({ message: "새우는 먹어도 돼", state: previous });
    expect(changed.excludedFoods).toEqual(["해산물"]);
    expect(changed.foodAllergy).toBe(true);
  });
});
