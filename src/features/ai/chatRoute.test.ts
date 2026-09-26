import { describe, expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "./dateBrief";
import {
  detectPlaceKind,
  isPlaceRequest,
  isQuestion,
  pendingLabelFor,
  pickedShownPlaces,
  placeQueryFromMessage,
  routeDateChatLocally,
} from "./chatRoute";

const route = (message: string, extra: Partial<Parameters<typeof routeDateChatLocally>[0]> = {}) => routeDateChatLocally({
  message,
  hasCourse: false,
  chatSituation: null,
  ...extra,
});

describe("chatRoute", () => {
  it("resumes a pending restaurant search when the user types its area", () => {
    const state = { ...emptyDateBrief(), placeAsk: { kind: "restaurant" as const, query: "파스타", area: "" } };
    expect(route("성수", { state })).toMatchObject({ mode: "places", placeAsk: { kind: "restaurant", query: "파스타", area: "성수" } });
    expect(route("성수 코스 짜줘", { state }).mode).toBe("course");
    expect(route("홍대 카페", { state })).toMatchObject({ mode: "places", placeAsk: { kind: "cafe", area: "홍대" } });
  });

  it("honors a new area when asking for more places", () => {
    const state = { ...withAreas(emptyDateBrief(), ["성수"]), shownPlaces: ["식당 A"], placeAsk: { kind: "restaurant" as const, query: "파스타", area: "성수" } };
    expect(route("홍대에서 다른 곳 더 보여줘", { state })).toMatchObject({ mode: "places", placeAsk: { area: "홍대", query: "파스타" } });
  });

  it("sends restaurant and cafe asks to place mode instead of the course form", () => {
    expect(route("성수 파스타 맛집 추천해줘")).toMatchObject({
      mode: "places",
      confident: true,
      placeAsk: { kind: "restaurant", query: "파스타", area: "성수" },
    });
    expect(route("을지로에서 저녁 먹을 데 알려줘").mode).toBe("places");
    expect(route("홍대 분위기 좋은 카페 어디야")).toMatchObject({ mode: "places", placeAsk: { kind: "cafe", area: "홍대" } });
    expect(route("행당 카페 추천해줘", { state: withAreas(emptyDateBrief(), ["뚝섬"]) })).toMatchObject({ mode: "places", placeAsk: { kind: "cafe", area: "행당" } });
    expect(route("연남에 와인바 있어?")).toMatchObject({ mode: "places", placeAsk: { kind: "bar" } });
    expect(route("초밥 먹고 싶어", { state: withAreas(emptyDateBrief(), ["성수"]) })).toMatchObject({
      mode: "places",
      placeAsk: { kind: "restaurant", query: "초밥", area: "성수" },
    });
  });

  it("keeps course requests in course mode", () => {
    expect(route("을지로 저녁 데이트 코스 짜줘")).toEqual({ mode: "course", confident: true });
    expect(route("성수에서 데이트하고 싶어")).toEqual({ mode: "course", confident: true });
    expect(route("제주 1박2일 여행 일정")).toEqual({ mode: "course", confident: true });
    expect(route("파스타 먹고 성수 걷는 코스로 짜줘").mode).toBe("course");
    expect(route("식당변경", { hasCourse: true })).toEqual({ mode: "course", confident: true });
    expect(route("카페 바꿔줘", { hasCourse: true })).toEqual({ mode: "course", confident: true });
  });

  it("routes follow-up questions about the course to question mode", () => {
    expect(route("이 카페 메뉴 추천해줘", { hasCourse: true }).mode).toBe("question");
    expect(route("2번 카페 메뉴 추천해줘", { hasCourse: true }).mode).toBe("question");
    expect(route("왜 식당이 변경됐어?", { hasCourse: true }).mode).toBe("question");
    expect(route("카페 바꿔야 할까?", { hasCourse: true }).mode).toBe("question");
    expect(route("왜 식당이 변경됐어? 원래대로 바꿔줘", { hasCourse: true }).mode).toBe("course");
    expect(route("첫 번째 식당 주차 돼?", { hasCourse: true })).toEqual({ mode: "question", confident: true });
    expect(route("예산은 얼마나 들까", { hasCourse: true })).toEqual({ mode: "question", confident: true });
    expect(route("거기 웨이팅 심해?", { hasCourse: true })).toEqual({ mode: "question", confident: true });
    expect(route("이 카페 왜 골랐어?", { hasCourse: true })).toEqual({ mode: "question", confident: true });
    expect(route("비 오면 어디 가지?", { hasCourse: true }).mode).toBe("question");
    expect(isQuestion("을지로 데이트 코스 짜줘", false)).toBe(false);
  });

  it("continues a place list with more or a course from the shown places", () => {
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      shownPlaces: ["파스타집 A", "파스타집 B", "파스타집 C"],
      placeAsk: { kind: "restaurant" as const, query: "파스타", area: "성수" },
    };
    expect(route("다른 곳 더 보여줘", { state })).toMatchObject({ mode: "places", confident: true, placeAsk: state.placeAsk });
    expect(route("이 중에서 코스 짜줘", { state })).toEqual({ mode: "course", confident: true, pickedPlaces: [] });
    expect(route("1번이랑 3번으로 코스 짜줘", { state })).toEqual({ mode: "course", confident: true, pickedPlaces: ["파스타집 A", "파스타집 C"] });
    expect(pickedShownPlaces("파스타집 B 넣어서", state.shownPlaces)).toEqual(["파스타집 B"]);
    expect(route("카페도 추천해줘", { state })).toMatchObject({ mode: "places", placeAsk: { kind: "cafe", area: "성수" } });
  });

  it("greets and small talk go to chat mode", () => {
    expect(route("안녕", { chatSituation: "greeting" })).toEqual({ mode: "chat", confident: true });
  });

  it("does not turn feedback or vague acknowledgements into a new course", () => {
    expect(route("이 코스 별로야", { hasCourse: true, chatSituation: "feedback" })).toEqual({ mode: "chat", confident: true });
    expect(route("그렇게 해줘", { hasCourse: true })).toEqual({ mode: "chat", confident: false });
    expect(route("고마워, 카페도 추천해줘", { chatSituation: null })).toMatchObject({ mode: "places", placeAsk: { kind: "cafe" } });
    expect(route("고마워, 2번 카페 주차 돼?", { hasCourse: true })).toMatchObject({ mode: "question" });
    expect(route("이 코스 별로야. 식당 바꿔줘", { hasCourse: true })).toMatchObject({ mode: "course" });
  });

  it("detects kinds and queries", () => {
    expect(detectPlaceKind("성수 디저트 맛있는 곳")).toBe("dessert");
    expect(detectPlaceKind("을지로 전시 볼만한 거 있어")).toBe("exhibit");
    expect(detectPlaceKind("방탈출 어디가 좋아")).toBe("activity");
    expect(detectPlaceKind("기회가 되면 회의")).toBeNull();
    expect(placeQueryFromMessage("성수 맛집 추천해줘", "restaurant")).toBe("맛집");
    expect(placeQueryFromMessage("한식 잘하는 집", "restaurant")).toBe("한식");
    expect(isPlaceRequest("성수 코스 짜줘")).toBe(false);
  });

  it("explains what it is doing while loading", () => {
    expect(pendingLabelFor("성수 파스타 맛집 추천해줘", false)).toContain("성수 식당");
    expect(pendingLabelFor("카페 추천해줘", false)).toContain("카페를 찾아보고");
    expect(pendingLabelFor("여기 주차 돼?", true)).toContain("질문");
    expect(pendingLabelFor("을지로 데이트 코스 짜줘", false)).toContain("동선");
  });
});
