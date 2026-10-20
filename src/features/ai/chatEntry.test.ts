import { describe, expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { plannerEntryIntake, plannerWelcomeCard } from "./chatEntry";

describe("conversational planner intake", () => {
  it.each(["date", "trip"] as const)("opens %s planning with a location question and no assumed location", kind => {
    const card = plannerWelcomeCard(kind);
    expect(card.headline).toContain("어느 지역");
    expect(card.suggestions).toContain("부산");
    expect(card.lines.join(" ")).toContain("목록에 없는 지역도 직접 입력");
  });

  it.each(["조용한 카페 추천해줘", "비오는 날 실내 데이트 코스 짜줘", "여행 일정 짜줘"])
  ("asks for the missing region without inventing one: %s", message => {
    const result = plannerEntryIntake({ kind: "date", message, state: emptyDateBrief() });
    expect(result?.slot).toBe("area");
    expect(result?.state.areas).toEqual([]);
  });

  it.each(["성수 조용한 카페 추천해줘", "대전에서 데이트 코스 짜줘", "부산 2박3일 여행 일정 짜줘"])
  ("passes requests with an explicit region straight through: %s", message => {
    expect(plannerEntryIntake({ kind: "date", message, state: emptyDateBrief() })).toBeNull();
  });

  it.each(["안녕", "왜 그 카페를 추천해?", "여행지 추천해줘", "아직 지역은 못 정했어"])
  ("keeps conversation and destination discovery in the engine: %s", message => {
    expect(plannerEntryIntake({ kind: "trip", message, state: emptyDateBrief() })).toBeNull();
  });

  it("asks only the missing trip duration and preserves the explicit destination", () => {
    const result = plannerEntryIntake({ kind: "trip", message: "부산 여행", state: emptyDateBrief() });
    expect(result?.slot).toBe("span");
    expect(result?.state.areas).toEqual(["부산"]);
    expect(result?.state.nights).toBe(0);
    expect(result?.state.stayKind).toBeNull();
    expect(result?.card.suggestions).toContain("2박3일");
  });

  it("does not turn a standalone venue request into trip duration intake", () => {
    expect(plannerEntryIntake({ kind: "trip", message: "카페 추천해줘", state: withAreas(emptyDateBrief(), ["제주"]) })).toBeNull();
  });
});
