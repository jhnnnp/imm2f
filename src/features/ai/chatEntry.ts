import type { AIChatCard, AIPlannerState, PlanKind } from "@/features/planning/types/plan";
import { DATE_AREA_OPTIONS, extractRequestedAreasFromText, extractStay, selectedAreas, withAreas } from "./dateBrief";
import { isQuestion, routeDateChatLocally } from "./chatRoute";
import { explicitDateConstraints } from "./dateConstraints";
import { explicitFoodExclusions, releasedFoodExclusions } from "./dateIntent";
import type { PlannerDialogueSlot } from "./plannerDialogueState";

export type { PlannerDialogueSlot } from "./plannerDialogueState";

export function plannerEntryState(input: { message: string; state: AIPlannerState; dateLabel?: string; today?: string }) {
  const writtenAreas = extractRequestedAreasFromText(input.message);
  const stay = extractStay(input.message);
  const constraints = explicitDateConstraints(input.message, input.state, input.today);
  const releases = releasedFoodExclusions(input.message);
  const exclusions = explicitFoodExclusions(input.message);
  const excludedFoods = [...new Set([...(input.state.excludedFoods ?? []).filter(food => !releases.includes(food)), ...exclusions])];
  const explicitAllergy = input.message.split(/[,，.;!?。\n]|그리고|하지만/).some(clause =>
    explicitFoodExclusions(clause).length > 0 && /알레르기/.test(clause)
    && !/알레르기(?:가|는|도)?\s*(?:없|아니)|알레르기.{0,8}(?:있을까|인가요|있나요)/.test(clause));
  return { ...(writtenAreas.length ? withAreas(input.state, writtenAreas) : input.state),
    ...(stay ?? {}), ...constraints, excludedFoods,
    foodAllergy: Boolean(input.state.foodAllergy || explicitAllergy),
    dateLabel: constraints.dateLabel || input.state.dateLabel || input.dateLabel || null };
}

/** These are choices, never a silently inferred destination. */
function areaChoices(suggestedAreas?: string[]) {
  return [...new Set([...(suggestedAreas ?? []).map(area => area.trim()).filter(Boolean), ...DATE_AREA_OPTIONS])].slice(0, 9);
}

export function plannerWelcomeCard(kind: PlanKind, suggestedAreas?: string[]): AIChatCard {
  return {
    headline: kind === "trip" ? "어느 지역으로 여행을 떠나시나요?" : "어느 지역에서 데이트하고 싶으세요?",
    lines: ["가고 싶은 도시나 동네를 골라 주세요. 원하는 장소·분위기·기간을 함께 적어 주셔도 좋아요.",
      "목록에 없는 지역도 직접 입력할 수 있어요. 좋아하는 음식이나 분위기가 있다면 함께 알려 주세요."],
    suggestions: areaChoices(suggestedAreas),
  };
}

/** Only clear, missing planning inputs are answered locally; open questions remain conversational. */
export function plannerEntryIntake(input: { kind: PlanKind; message: string; state: AIPlannerState;
  dateLabel?: string; today?: string; suggestedAreas?: string[] }): {
  slot: PlannerDialogueSlot;
  state: AIPlannerState;
  card: AIChatCard;
} | null {
  if (isExplorationConversationAside(input.message) || /^\s*왜/.test(input.message)) return null;
  const undecided = /(?:어디|지역|도시|동네|여행지|목적지).{0,12}(?:추천|정해|골라|모르|미정)|아직.{0,10}(?:모르|못\s*정)/.test(input.message);
  const routeRequest = /(?:가는\s*(?:길|법)|출발.{0,16}(?:동선|경로|길|방법)|출발지.{0,16}(?:경로|일정))/.test(input.message);
  if (isQuestion(input.message, false) && !routeRequest && !undecided) return null;
  const route = routeDateChatLocally({ message: input.message, state: input.state, hasCourse: false, chatSituation: null });
  if ((!route.confident || (route.mode !== "course" && route.mode !== "places")) && !undecided && !routeRequest) return null;
  const state = plannerEntryState(input);
  if (!selectedAreas(state).length) return { slot: "area", state,
    card: { ...plannerWelcomeCard(input.kind, input.suggestedAreas), lines: [undecided
      ? "아래 도시나 동네 중에서 시작할 지역을 골라 주세요. 다른 목적지를 직접 입력해도 좋아요. 선택한 지역 안에서 취향에 맞는 장소를 찾아볼게요."
      : "어느 도시나 동네에서 찾을까요? 방금 말씀하신 취향과 조건은 그대로 반영할게요."] } };
  if (input.kind === "trip" && route.mode === "course" && !state.stayKind && !extractStay(input.message)) {
    return { slot: "span", state, card: { headline: "여행 기간을 알려 주세요",
      lines: ["며칠 동안 여행하시나요? 기간에 맞춰 장소와 하루별 동선을 함께 짤게요."],
      suggestions: ["당일치기", "1박2일", "2박3일", "직접 입력"] } };
  }
  // Recommendations need a destination and trip length. Dates, transport and
  // departure details remain optional instructions, never another intake gate.
  return null;
}

/** The shortlist wizard is available when the user asks to choose candidates first. */
export function requestsCandidateExploration(message: string) {
  return /(?:장소\s*)?(?:후보|탐색).{0,12}(?:먼저|부터|시작|찾|보여|골라|선택)|(?:먼저|우선).{0,12}(?:장소|후보).{0,12}(?:골라|선택|둘러|비교)/.test(message)
    && !/후보.{0,10}(?:말고|없이|건너뛰)|바로.{0,10}(?:일정|코스)/.test(message);
}

export function isExplorationConversationAside(message: string) {
  if (/추천|(?:코스|일정|계획).{0,12}(?:짜|만들|바꿔)|(?:여행|데이트).{0,8}(?:가|하고)|에서\s*출발/.test(message)) return false;
  return /^(?:안녕|안녕하세요|고마워|감사|하이|헬로|hi\b|hello\b|thanks\b)/i.test(message.trim())
    || /(?:그냥|잠깐).{0,6}(?:대화|잡담|수다)|(?:대화|잡담|수다)\s*(?:하자|할래|해줘)/.test(message);
}

export function requestsDirectPlanning(message: string) {
  return /(?:후보|선택|탐색).{0,12}(?:말고|없이|건너뛰|그만|종료)|(?:네가|알아서|자동으로).{0,15}(?:코스|일정).{0,12}(?:짜|만들)|바로.{0,12}(?:코스|일정).{0,12}(?:짜|만들)/.test(message);
}
