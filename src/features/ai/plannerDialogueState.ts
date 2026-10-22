import type { AIPlannerState } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";

export type PlannerDialogueSlot = "area" | "span" | "date" | "transport" | "origin";

export type PendingPlannerDialogue = { turns: string[]; slot: PlannerDialogueSlot };

const UNKNOWN_ORIGIN = /^(?:아직|미정|모르|정하지|못\s*정|없|어디|어느|추천|골라|정해|나중|추후|고려|출발지|목적지|도착지|현지|그곳|여기|거기|저기)/;

/** A reference to the departure field is not a supplied departure place. */
export function hasPlannerOrigin(message: string) {
  const departures = [...message.matchAll(/([^\s,，;.!?。\n]{2,35})(?:에서|부터)\s*출발/g)]
    .map(match => match[1]);
  const labelled = [...message.matchAll(/출발(?:지|하는\s*곳)(?:\s*(?:는|은|:)\s*|\s+)([^,，;.!?。\n]{2,60})/g)]
    .map(match => match[1].trim());
  return [...departures, ...labelled].some(origin => !UNKNOWN_ORIGIN.test(origin)
    && !/^(?:대중교통|지하철|버스|자가용|렌터카|도보|택시)(?:으로|로)?$/.test(origin));
}

/** Transport words in a terminal name must not turn an origin answer into a
 * detour question. Actual questions stay available during intake. */
export function isPlannerOriginAnswer(message: string) {
  const text = message.trim();
  if (/[?？]|어디|어느|어떻게|뭐가|뭘|나아|낫|어때|갈까|탈까|좋을까|있(?:어|나|을까)|될까|인가|일까|몇\s*시|얼마|추천|알려|정해/.test(text)) return false;
  return hasPlannerOrigin(text)
    || /^[가-힣A-Za-z0-9· ()-]{2,60}(?:역|터미널|정류장|정류소|공항|항구|버스센터|환승센터)(?:\s*(?:근처|앞|입구))?(?:에서|부터)?[.!~]*$/.test(text);
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
