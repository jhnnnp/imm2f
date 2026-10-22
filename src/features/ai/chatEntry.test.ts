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

  it.each(["안녕", "왜 그 카페를 추천해?"])
  ("keeps conversation and destination discovery in the engine: %s", message => {
    expect(plannerEntryIntake({ kind: "trip", message, state: emptyDateBrief() })).toBeNull();
  });

  it.each(["여행지 추천해줘", "아직 지역은 못 정했어"])("offers concrete unselected regions when the destination is undecided: %s", message => {
    const result = plannerEntryIntake({ kind: "trip", message, state: emptyDateBrief(), suggestedAreas: ["증평"] });
    expect(result?.slot).toBe("area");
    expect(result?.state.areas).toEqual([]);
    expect(result?.card.suggestions?.[0]).toBe("증평");
    expect(result?.card.lines.join(" ")).toContain("직접 입력");
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

  it("recommends performance venues without requiring an attendance date", () => {
    const request = { kind: "date" as const, message: "성수에서 연극 보고 저녁 데이트 코스 짜줘", state: emptyDateBrief() };
    expect(plannerEntryIntake(request)).toBeNull();
    expect(plannerEntryIntake({ ...request, dateLabel: "2026-10-24" })).toBeNull();
    expect(plannerEntryIntake({ ...request, message: `${request.message}\n2026-10-25` })).toBeNull();
    expect(plannerEntryIntake({ ...request, message: "성수 조용한 카페 추천해줘" })).toBeNull();
  });

  it("recommends a route without requiring transport or departure details", () => {
    const request = { kind: "trip" as const, message: "부산 1박2일 여행 일정과 가는 법 알려줘", state: emptyDateBrief() };
    expect(plannerEntryIntake(request)).toBeNull();
    const transport = { ...request, message: `${request.message}\n대중교통으로 갈게` };
    expect(plannerEntryIntake(transport)).toBeNull();
    const complete = { ...transport, message: `${transport.message}\n서울역에서 출발` };
    expect(plannerEntryIntake(complete)).toBeNull();
    expect(plannerEntryIntake({ ...transport, message: `${transport.message}\n현지 코스만 추천해줘` })).toBeNull();
    expect(plannerEntryIntake({ ...request, message: "부산 1박2일 여행 일정 짜줘" })).toBeNull();
    expect(plannerEntryIntake({ ...request, message: "부산 대중교통으로 1박2일 일정 짜줘" })).toBeNull();
    expect(plannerEntryIntake({ ...request, message: "부산 1박2일 장소 사이 이동 경로도 고려해줘" })).toBeNull();
  });

  it("does not collect an attendance date for a rejected experience", () => {
    expect(plannerEntryIntake({ kind: "date", message: "성수에서 공연은 빼고 카페 데이트 코스 짜줘", state: emptyDateBrief() })).toBeNull();
  });

  it.each(["출발지는 아직 미정", "출발지부터 고려한 경로로 짜줘", "출발지는 정해지지 않았어"])
  ("does not block venue recommendations on unspecified departure details: %s", detail => {
    const message = `부산 1박2일 여행 일정과 가는 법 알려줘\n대중교통으로 갈게\n${detail}`;
    expect(plannerEntryIntake({ kind: "trip", message, state: emptyDateBrief() })).toBeNull();
  });

  it("completes route intake with a terminal answer without replacing the destination", () => {
    const message = "부산 1박2일 여행 일정과 가는 법 알려줘\n대중교통으로 갈게\n서울고속버스터미널에서 출발";
    expect(plannerEntryIntake({ kind: "trip", message, state: emptyDateBrief() })).toBeNull();
  });
});
