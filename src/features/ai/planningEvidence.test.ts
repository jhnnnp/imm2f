import { expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { requiredOpeningTime } from "./planningEvidence";

const requirement = "오후 9시에 반드시 영업하는 곳만 골라줘";
const opening = (...userRequests: string[]) => requiredOpeningTime({ ...emptyDateBrief(), userRequests });

it.each(["선택한 장소로 일정 짜줘", "카페 한 곳 추가해줘", "영업시간 알려줘", "시작 시간을 20:00로 바꿔줘"])(
  "keeps the exact opening requirement through unrelated follow-ups: %s", latest => {
    expect(opening(requirement, latest)).toBe("21:00");
  });

it("replaces a confirmed opening requirement only with an explicit opening-time correction", () => {
  expect(opening(requirement, "22:00에 영업하는 곳으로 변경해줘", "선택한 장소로 일정 짜줘")).toBe("22:00");
  expect(opening(requirement, "오후 10시에 반드시 열려 있는 곳만")).toBe("22:00");
});

it.each(["영업시간은 상관없어", "영업 조건 빼줘", "운영 여부는 무관해"])(
  "releases the explicit requirement when the user removes it: %s", latest => {
    expect(opening(requirement, latest, "선택한 장소로 일정 짜줘")).toBeNull();
  });

it("does not invent an opening requirement from a schedule or a practical question", () => {
  expect(opening("21:00부터 카페 코스", "그때 영업해?")).toBeNull();
});
