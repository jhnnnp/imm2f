import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import { candidateActivitySlot } from "./dateCourse";
import { decisionUsefulVenueObservation, hardCourseProblems, evaluateCourse } from "./courseDesign";
import { courseMutationProblems } from "./courseMutation";
import { emptyDateBrief } from "./dateBrief";
import { applyInterpretPatch, fallbackPatch } from "@/lib/openai/interpretDateRequest";

// Fixed, anonymous failure patterns. These run without network or a mutable
// search index, so failures remain attributable to our intent and course code.
const REQUESTS = [
  ["왕십리에서 저녁 먹고 예쁜 카페와 공연장 데이트 코스", "왕십리", ["meal", "cafe", "performance"]],
  ["성수에서 파스타 먹고 전시 보러 가자", "성수", ["meal", "exhibit"]],
  ["홍대에서 영화 보고 커피 마시고 싶어", "홍대", ["movie", "cafe"]],
  ["잠실에서 야경과 카페 데이트", "잠실", ["nightview", "cafe"]],
  ["을지로에서 전시와 저녁 식사", "을지로", ["exhibit", "meal"]],
  ["한남에서 연극 보고 싶어", "한남", ["performance"]],
  ["종로에서 박물관 데이트", "종로", ["exhibit"]],
  ["성수에서 보드게임 하고 커피 마시기", "성수", ["indoor", "cafe"]],
  ["왕십리에서 공연 보고 파스타 먹기", "왕십리", ["performance", "meal"]],
  ["홍대에서 산책하고 디저트 카페", "홍대", ["walk", "cafe"]],
  ["익선동에서 한옥 카페 데이트", "익선동", ["cafe"]],
  ["성수에서 전시와 카페 투어", "성수", ["exhibit", "cafe"]],
  ["강남에서 영화와 저녁 데이트", "강남", ["movie"]],
  ["제주에서 관광지와 맛집 여행", "제주", ["meal"]],
  ["부산에서 카페와 산책", "부산", ["cafe", "walk"]],
  ["망원에서 저녁 먹고 한강공원 산책", "망원", ["meal", "walk"]],
  ["서울숲에서 사진 찍고 카페", "서울숲", ["cafe"]],
  ["혜화에서 뮤지컬과 저녁 식사", "혜화", ["performance", "meal"]],
  ["연남에서 브런치와 전시", "연남", ["meal", "exhibit"]],
  ["서촌에서 미술관과 커피", "서촌", ["exhibit", "cafe"]],
] as const;

const EDIT_REQUESTS = [
  ["일정추가", "modify", true, ""],
  ["일정 하나 더 추가해줘", "modify", true, ""],
  ["전시 추가해줘", "modify", true, "exhibit"],
  ["카페 한 곳 더 넣어줘", "modify", true, "cafe"],
  ["영화 일정 추가해줘", "modify", true, "movie"],
  ["보드게임 추가해줘", "modify", true, "indoor"],
  ["파스타 먹는 일정 추가해줘", "modify", true, "meal"],
  ["산책 한 곳 추가해줘", "modify", true, "walk"],
  ["뮤지컬 일정 추가해줘", "modify", true, "performance"],
  ["저녁 식사 추가해줘", "modify", true, "meal"],
  ["일정제외", "remove", false, ""],
  ["소월아트홀 빼줘", "remove", false, ""],
  ["카페 빼줘", "remove", false, "cafe"],
  ["공연 제외해줘", "remove", false, "performance"],
  ["전시 빼줘", "remove", false, "exhibit"],
  ["영화 일정 삭제해줘", "remove", false, "movie"],
  ["카페 하나 빼고 싶어", "remove", false, "cafe"],
  ["처음부터 새로 짜줘", "reset", false, ""],
  ["기존 코스 전부 바꿔줘", "reset", false, ""],
  ["코스 리셋해줘", "reset", false, ""],
] as const;

const VENUES = [
  ["소월아트홀", "문화,예술 > 공연장", "photo", "performance"],
  ["할리스 소월아트홀점", "카페 > 커피전문점", "cafe", "cafe"],
  ["케이크숲", "카페 > 디저트카페", "cafe", "cafe"],
  ["보드게임카페", "카페 > 보드카페", "cafe", "indoor"],
  ["동네 소극장", "문화,예술 > 소극장", "photo", "performance"],
  ["왕십리갤러리", "문화,예술 > 전시관", "photo", "exhibit"],
  ["CGV왕십리", "문화,예술 > 영화관", "photo", "movie"],
  ["경의선숲길", "여행 > 산책로", "nature", "walk"],
  ["칼국수집", "음식점 > 한식", "restaurant", "meal"],
  ["북카페", "카페 > 북카페", "cafe", "cafe"],
] as const;

function venue(id: string, name: string, category: DiscoverCandidate["category"], detailedCategory: string): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name, category, categoryLabel: detailedCategory,
    detailedCategory, kakaoCategoryGroupCode: category === "cafe" ? "CE7" : category === "restaurant" ? "FD6" : "CT1",
    district: "성동구", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [127.04 + Number(id) * 0.0001, 37.56] };
}

function reply(...places: Array<[string, string, "meal" | "cafe" | "performance" | "exhibit"]>): AIPlannerReply {
  return { recommendations: places.map(([placeId, name, activitySlot]) => ({ placeId, name, activitySlot })) } as AIPlannerReply;
}

describe("date engine fixed regression corpus", () => {
  it.each(REQUESTS)("intent: %s", (message, area, required) => {
    const state = applyInterpretPatch({ message, patch: fallbackPatch(message) }).state;
    expect(state.areas).toContain(area);
    expect(state.activities).toEqual(expect.arrayContaining(required));
  });

  it.each(EDIT_REQUESTS)("edit intent: %s", (message, intent, addStop, activity) => {
    const patch = fallbackPatch(message);
    expect(patch.intent).toBe(intent);
    expect(patch.addStop).toBe(addStop);
    if (activity) {
      expect(intent === "remove" ? patch.removeActivities : patch.addActivities).toContain(activity);
    }
  });

  it.each(VENUES)("role: %s", (name, detailedCategory, category, slot) => {
    expect(candidateActivitySlot(venue("1", name, category, detailedCategory))).toBe(slot);
  });

  const before = reply(["kakao:meal", "칼국수집", "meal"], ["kakao:cafe", "정원카페", "cafe"], ["kakao:hall", "소월아트홀", "performance"]);
  const EDITS = [
    ["식당 변경", "meal", "meal", false],
    ["식당 변경인데 카페가 옴", "meal", "cafe", true],
    ["카페 변경", "cafe", "cafe", false],
    ["카페 변경인데 보드카페가 옴", "cafe", "exhibit", true],
    ["공연장 변경", "performance", "performance", false],
    ["공연장 변경인데 카페가 옴", "performance", "cafe", true],
  ] as const;
  it.each(EDITS)("swap: %s", (_label, oldSlot, newSlot, mustReject) => {
    const removed = before.recommendations.find(place => place.activitySlot === oldSlot)!;
    const next = { ...before, recommendations: before.recommendations.map(place => place.placeId === removed.placeId
      ? { ...place, placeId: "kakao:new", name: "새 장소", activitySlot: newSlot } : place) };
    const state = { ...emptyDateBrief(), intent: "modify" as const, excludedPlaces: [removed.name] };
    expect(courseMutationProblems(before, next, state).includes("장소 교체 역할 불일치")).toBe(mustReject);
  });

  const ADDITIONS = [
    ["일정 추가: 전시", "exhibit", "일정추가", false],
    ["일정 추가: 두 번째 식당", "meal", "일정추가", true],
    ["일정 추가: 두 번째 카페", "cafe", "일정추가", true],
    ["일정 추가: 두 번째 공연장", "performance", "일정추가", true],
    ["카페 투어 명시", "cafe", "카페 한 곳 더 추가해줘", false],
    ["미식 투어 명시", "meal", "식당 한 곳 더 추가해줘", false],
  ] as const;
  it.each(ADDITIONS)("add: %s", (_label, slot, message, mustReject) => {
    const next = { ...before, recommendations: [...before.recommendations, { placeId: "kakao:new", name: "새 장소", activitySlot: slot }] };
    const state = { ...emptyDateBrief(), intent: "modify" as const, addStop: true, userRequests: [message] };
    expect(courseMutationProblems(before, next, state).some(problem => problem.startsWith("일정 추가 경험 중복"))).toBe(mustReject);
  });

  const OBSERVATIONS = [
    ["마당 정원과 야외 테라스 좌석이 있습니다.", true],
    ["전국에 400개 매장을 운영합니다.", false],
    ["서울 성동구 왕십리로에 위치한 카페입니다.", false],
    ["영업시간은 11:00부터 22:00까지입니다.", false],
    ["예약 가능합니다.", false],
    ["통창을 통해 거리 풍경이 보입니다.", true],
    ["다양한 음료를 제공하는 카페입니다.", false],
    ["수제 케이크가 대표 메뉴입니다.", true],
  ] as const;
  it.each(OBSERVATIONS)("evidence: %s", (observation, useful) => {
    expect(decisionUsefulVenueObservation(venue("1", "동네 카페", "cafe", "카페 > 커피전문점"), observation)).toBe(useful);
  });

  it("course judge rejects a repeated meal although it increases the stop count", () => {
    const candidates = [venue("1", "칼국수집", "restaurant", "음식점 > 한식"), venue("2", "정원카페", "cafe", "카페 > 커피전문점"), venue("3", "냉면집", "restaurant", "음식점 > 한식")];
    const state = { ...emptyDateBrief(), addStop: true, pinOrder: ["칼국수집", "정원카페"], requiredPlaces: ["칼국수집", "정원카페"], userRequests: ["일정추가"] };
    const proposal = { theme: "", rows: candidates.map(candidate => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: 0 })) };
    expect(hardCourseProblems(evaluateCourse(proposal, candidates, state, new Set()).problems)).toContain("식사 중복");
  });
});
