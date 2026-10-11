import { expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { explicitPlanningChoices, explorationFollowUpIntent, visibleExplorationCards } from "./candidateConversation";
import type { CandidateGroup, ExplorationCard } from "./candidateExploration";

const state = withAreas(emptyDateBrief(), ["성수"]);
it.each(["제주로 변경해줘", "부산", "부산 카페 찾아줘", "3박4일로 바꿔줘", "하루만으로 바꿔줘", "일정은 더 여유롭게", "땅콩 알레르기가 있어", "차로 이동할게", "대중교통으로 다닐 거야", "오후 3시부터 시작할게", "18시까지 끝내고 귀가할게"])("routes an explicit global condition through intake: %s", message => {
  expect(explorationFollowUpIntent(message, state)).toBe("conditions");
});
it.each(["부산이랑 성수는 얼마나 멀어?", "3박4일이면 될까?", "예산 5만원이면 괜찮을까?", "차로 이동하는 게 어때?", "부산으로 바꾸면 어떨까", "1번 카페 주차 가능해?", "카페 영업시간 알려줘", "1번 주소 알려줘", "왜 제주로 바뀌었어?"])("keeps questions read-only: %s", message => {
  expect(explorationFollowUpIntent(message, state)).toBe("question");
});
it.each(["선택한 장소로 일정 짜줘", "이 장소들로 코스 만들어줘", "선택한 장소로 다시 짜줘", "이걸로 짜줘"])("starts planning rather than searching again: %s", message => {
  expect(explorationFollowUpIntent(message, state)).toBe("plan");
});
it.each(["다른 카페 더 보여줘", "좀 더 바다가 보이는 카페", "더 조용한 카페 찾아줘", "제주 음식을 파는 성수 식당 찾아줘"])("keeps venue refinements scoped to candidate search: %s", message => {
  expect(explorationFollowUpIntent(message, state)).toBe("refine");
});
it("numbers only unique, visible venues and skips rejected cards", () => {
  const card = (id: number) => ({ candidateId: `kakao:${id}`, name: `후보 ${id}` }) as ExplorationCard;
  const groups = [{ cards: [card(1), card(2)] }, { cards: [card(2), card(3)] }] as CandidateGroup[];
  expect(visibleExplorationCards(groups, ["kakao:1"]).map(item => item.candidateId)).toEqual(["kakao:2", "kakao:3"]);
});

const cards = Array.from({ length: 12 }, (_, index) => ({ candidateId: `kakao:${index + 1}`, name: `후보 장소 ${index + 1}` }) as ExplorationCard);
it("uses every explicitly numbered planning choice without a four-place cap", () => {
  expect(explicitPlanningChoices("1번 2번 3번 4번 10번 11번 12번으로 일정 짜줘", cards, []).cards?.map(card => card.candidateId))
    .toEqual(["kakao:1", "kakao:2", "kakao:3", "kakao:4", "kakao:10", "kakao:11", "kakao:12"]);
});
it("rejects absent or mixed add/remove references without changing existing choices", () => {
  expect(explicitPlanningChoices("13번으로 일정 짜줘", cards, [cards[0]])).toEqual({ cards: null, invalid: true });
  expect(explicitPlanningChoices("1번 빼고 3번 추가해서 일정 짜줘", cards, [cards[0]])).toEqual({ cards: null, invalid: true });
});
it("removes a referenced candidate while preserving the rest of the shortlist", () => {
  expect(explicitPlanningChoices("2번 빼고 일정 짜줘", cards, cards.slice(0, 3)).cards?.map(card => card.candidateId))
    .toEqual(["kakao:1", "kakao:3"]);
});
it("does not also select a similarly named branch or shorter name", () => {
  expect(explicitPlanningChoices("후보 장소 11로 일정 짜줘", cards, []).cards?.map(card => card.candidateId)).toEqual(["kakao:11"]);
});
