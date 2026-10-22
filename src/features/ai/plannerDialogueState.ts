import type { AIPlannerState } from "@/features/planning/types/plan";
import { emptyDateBrief, extractRequestedAreasFromText, extractStay } from "./dateBrief";

export type PlannerDialogueSlot = "area" | "span";

export type PendingPlannerDialogue = { turns: string[]; slot: PlannerDialogueSlot };

/** A region or trip-length answer can include optional preferences such as
 * transport. Those words alone do not turn the answer into a new question. */
export function answersPlannerDialogue(slot: PlannerDialogueSlot, message: string) {
  if (/[?？]|어떻게|어느|언제|뭐가|뭘|나아|낫|어때|좋을까|알려|추천해|왜/.test(message)) return false;
  return slot === "area" ? extractRequestedAreasFromText(message).length > 0 : Boolean(extractStay(message));
}

export function startsNewPlannerDialogue(message: string) {
  return /^(?:처음부터|새(?:로운)?\s*(?:여행|데이트|계획|일정)|이전\s*(?:요청|조건|계획)은?\s*(?:취소|잊어))/.test(message.trim());
}

/** Intake does not synthesize a new user instruction or drop an earlier one.
 * Long requests fit the per-message API limit by keeping earlier exact turns
 * in the existing conversation state instead of truncating their conditions. */
export function resumePlannerDialogue(turns: string[], latest: string, state: AIPlannerState) {
  const reset = startsNewPlannerDialogue(latest);
  const previous = reset ? [] : turns;
  if (reset) state = emptyDateBrief();
  const combined = previous.join("\n");
  const nextTurns = !latest ? previous : latest === combined ? previous
    : previous.at(-1) === latest ? previous : [...previous, latest];
  const request = nextTurns.join("\n");
  if (request.length <= 800) return { turns: nextTurns, request, state };
  const earlier = nextTurns.slice(0, -1);
  const unique = (values: string[]) => [...new Set(values)];
  return { turns: nextTurns, request: nextTurns.at(-1) ?? "", state: {
    ...state,
    userRequests: unique([...(state.userRequests ?? []), ...earlier]),
    conversationNotes: unique([...state.conversationNotes, ...earlier]),
  } };
}
