import { expect, it } from "vitest";
import { explicitlyDislikedActivities } from "./dateActivityExclusions";

it.each([
  ["야경은 빼고 전시 추가해줘", ["nightview"]],
  ["영화 말고 공연으로 바꿔줘", ["movie"]],
  ["공연은 제외해줘", ["performance"]],
  ["전시는 싫어", ["exhibit"]],
  ["방탈출은 안 좋아해", ["indoor"]],
  ["카페는 좋아하고 식사는 싫어", ["meal"]],
  ["카페는 안 좋아하는 건 아니야", []],
  ["정원카페 빼줘", []],
  ["그 카페 말고 다른 카페", []],
])("grounds activity exclusions in the relevant preference: %s", (message, expected) => {
  expect(explicitlyDislikedActivities(message)).toEqual(expected);
});
