import type { DateGoalType } from "../dateTurnUnderstanding";
import type { DateExecutionTaskType } from "../dateExecutionPlan";

/** Korean conversation fixtures. Expected outcomes are semantic structures, never model wording. */
export type DateLimitedFixture = {
  id: string;
  turns: string[];
  expectedGoals: DateGoalType[];
  expectedTasks: DateExecutionTaskType[];
  context: "new" | "plan" | "session";
  expectsUnresolvedReference?: boolean;
  avoidPreviouslyShown?: boolean;
  expectedUnknownFacts?: string[];
  expectedFeedback?: Array<{ attribute: string; sentiment: "positive" | "negative" }>;
};

export const DATE_LIMITED_FIXTURES: DateLimitedFixture[] = [
  { id: "single_places", turns: ["성수 카페 추천해줘"], context: "new",
    expectedGoals: ["recommend_places"], expectedTasks: ["recommend_places"] },
  { id: "other_places", turns: ["성수 카페 추천해줘", "아까 보여준 데 말고 다른 카페 보여줘"],
    context: "session", expectedGoals: ["recommend_places"], expectedTasks: ["recommend_places"],
    avoidPreviouslyShown: true },
  { id: "compare_places", turns: ["카페 A랑 카페 B 중 어디가 나아?"], context: "session",
    expectedGoals: ["compare_places"], expectedTasks: ["compare_places"] },
  { id: "feedback_then_recommend", turns: ["카페 A 보여줘", "카페 A는 너무 시끄러웠어",
    "다른 카페 추천해줘"], context: "session", expectedGoals: ["recommend_places"],
    expectedTasks: ["recommend_places"], avoidPreviouslyShown: true,
    expectedFeedback: [{ attribute: "noise", sentiment: "negative" }] },
  { id: "partial_course_edit", turns: ["성수 데이트 코스 짜줘", "두 번째 장소 빼줘"],
    context: "plan", expectedGoals: ["modify_itinerary"], expectedTasks: ["modify_itinerary"] },
  { id: "edit_and_venue_question", turns: ["저녁 바꿔주고 지금 카페 주차 돼?"],
    context: "plan", expectedGoals: ["modify_itinerary", "ask_venue"],
    expectedTasks: ["modify_itinerary", "inspect_venue"] },
  { id: "edit_and_explain", turns: ["저녁 바꿔주고 왜 카페 A 넣었어?"],
    context: "plan", expectedGoals: ["modify_itinerary", "explain_recommendation"],
    expectedTasks: ["modify_itinerary", "explain_recommendation"] },
  { id: "recommend_and_compare", turns: ["다른 카페 추천해주고 카페 A랑 카페 B도 비교해줘"],
    context: "session", expectedGoals: ["recommend_places", "compare_places"],
    expectedTasks: ["recommend_places", "compare_places"] },
  { id: "feedback_and_recommend", turns: ["카페 A는 예쁜데 너무 시끄러웠어. 다른 카페 추천해줘"],
    context: "session", expectedGoals: ["provide_feedback", "recommend_places"],
    expectedTasks: ["record_feedback", "recommend_places"], avoidPreviouslyShown: true,
    expectedFeedback: [{ attribute: "aesthetic", sentiment: "positive" },
      { attribute: "noise", sentiment: "negative" }] },
  { id: "three_goals", turns: ["저녁 바꿔주고 카페 A 주차 확인하고 카페 B와 비교해줘"],
    context: "plan", expectedGoals: ["modify_itinerary", "ask_venue", "compare_places"],
    expectedTasks: ["modify_itinerary", "inspect_venue", "compare_places"] },
  { id: "ambiguous_reference", turns: ["카페 A와 카페 B 보여줘", "거기 말고 다른 곳"],
    context: "session", expectedGoals: ["recommend_places"], expectedTasks: ["recommend_places"],
    expectsUnresolvedReference: true },
  { id: "stale_opening_hours", turns: ["카페 A랑 카페 B 영업시간 비교해줘"],
    context: "session", expectedGoals: ["compare_places"], expectedTasks: ["compare_places"],
    expectedUnknownFacts: ["opening_hours"] },
  { id: "budget_and_food", turns: ["성수에서 10만원 이하 파스타집 추천해줘. 돼지고기는 빼줘"],
    context: "new", expectedGoals: ["recommend_places"], expectedTasks: ["recommend_places"] },
];
