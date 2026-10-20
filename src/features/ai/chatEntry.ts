import type { AIChatCard, AIPlannerState, DateIntakeSlot, PlanKind } from "@/features/planning/types/plan";
import { DATE_AREA_OPTIONS, extractRequestedAreasFromText, extractStay, selectedAreas, withAreas } from "./dateBrief";
import { isQuestion, routeDateChatLocally } from "./chatRoute";

export function plannerWelcomeCard(kind: PlanKind): AIChatCard {
  return {
    headline: kind === "trip" ? "어느 지역으로 여행을 떠나시나요?" : "어느 지역에서 데이트하고 싶으세요?",
    lines: ["가고 싶은 도시나 동네를 골라 주세요. 원하는 장소·분위기·기간을 함께 적어 주셔도 좋아요.",
      "목록에 없는 지역도 직접 입력할 수 있어요. 정해 둔 시간과 취향이 있다면 함께 알려 주세요."],
    suggestions: [...DATE_AREA_OPTIONS],
  };
}

/** Only clear, missing planning inputs are answered locally; open questions remain conversational. */
export function plannerEntryIntake(input: { kind: PlanKind; message: string; state: AIPlannerState }): {
  slot: Extract<DateIntakeSlot, "area" | "span">;
  state: AIPlannerState;
  card: AIChatCard;
} | null {
  if (isExplorationConversationAside(input.message) || isQuestion(input.message, false) || /^\s*왜/.test(input.message)
    || /(?:어디|지역|도시|동네|여행지|목적지).{0,12}(?:추천|정해|골라|모르|미정)|아직.{0,10}(?:모르|못\s*정)/.test(input.message)) return null;
  const route = routeDateChatLocally({ message: input.message, state: input.state, hasCourse: false, chatSituation: null });
  if (!route.confident || (route.mode !== "course" && route.mode !== "places")) return null;
  const writtenAreas = extractRequestedAreasFromText(input.message);
  const state = writtenAreas.length ? withAreas(input.state, writtenAreas) : input.state;
  if (!selectedAreas(state).length) return { slot: "area", state,
    card: { ...plannerWelcomeCard(input.kind), lines: ["어느 도시나 동네에서 찾을까요? 방금 말씀하신 취향과 조건은 그대로 반영할게요."] } };
  if (input.kind === "trip" && route.mode === "course" && !state.stayKind && !extractStay(input.message)) {
    return { slot: "span", state, card: { headline: "여행 기간을 알려 주세요",
      lines: ["며칠 동안 여행하시나요? 기간에 맞춰 장소와 하루별 동선을 함께 짤게요."],
      suggestions: ["당일치기", "1박2일", "2박3일", "직접 입력"] } };
  }
  return null;
}

/** The shortlist wizard is available when the user asks to choose candidates first. */
export function requestsCandidateExploration(message: string) {
  return /(?:장소\s*)?(?:후보|탐색).{0,12}(?:먼저|부터|시작|찾|보여|골라|선택)|(?:먼저|우선).{0,12}(?:장소|후보).{0,12}(?:골라|선택|둘러|비교)/.test(message)
    && !/후보.{0,10}(?:말고|없이|건너뛰)|바로.{0,10}(?:일정|코스)/.test(message);
}

export function isExplorationConversationAside(message: string) {
  return /^(?:안녕|안녕하세요|고마워|감사|하이|헬로|hi\b|hello\b|thanks\b)/i.test(message.trim())
    || /(?:그냥|잠깐).{0,6}(?:대화|잡담|수다)|(?:대화|잡담|수다)\s*(?:하자|할래|해줘)/.test(message);
}

export function requestsDirectPlanning(message: string) {
  return /(?:후보|선택|탐색).{0,12}(?:말고|없이|건너뛰|그만|종료)|(?:네가|알아서|자동으로).{0,15}(?:코스|일정).{0,12}(?:짜|만들)|바로.{0,12}(?:코스|일정).{0,12}(?:짜|만들)/.test(message);
}
