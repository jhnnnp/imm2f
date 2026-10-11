import type { ChatRoute } from "@/features/ai/chatRoute";
import type { DateChatTurn } from "@/features/planning/types/plan";
import { resolveQuestionFocus } from "./answerDateQuestion";

/** Model output may propose an edit, but only user instructions can authorize its targets. */
export function groundedCourseEdit(input: {
  message: string; currentCourse: string[]; currentCategories?: string[]; conversation?: DateChatTurn[];
}, edit: NonNullable<ChatRoute["edit"]>) {
  let message = input.message;
  if (/^(?:응|네|좋아|좋아요|그래|그렇게|맞아|맞아요)(?:\s|그렇게|해\s*줘|해주세요|해요|요|[.!~])*$/.test(message.trim())) {
    message = [...(input.conversation ?? [])].reverse().find(turn => turn.role === "user" && turn.text !== input.message)?.text ?? "";
  }
  if (!message || /(?:할까|될까|해도|빼도|어때|좋을까|가능|되면|하면|할\s*수|할지|으면|다면|면\s*(?:빼|제외|삭제|제거)|경우|만약)/.test(message)) return false;
  if (edit.kind === "retime") return /시간|시작|늦춰|앞당|여유|체류|머무|머물|분|시부터/.test(message)
    && /고쳐|바꿔|변경|조정|줄여|늘려|맞춰|해\s*줘|해주세요|늦춰|앞당/.test(message)
    && !/빼|삭제|제외|제거|교체|추가|순서/.test(message);
  const numberRefs = [...message.matchAll(/(?<!\d)(\d+)\s*번/g)].map(match => Number(match[1]));
  if (edit.kind === "reorder") {
    if (!/순서|먼저|마지막|앞으로|뒤로/.test(message)) return false;
    if (numberRefs.length === input.currentCourse.length && new Set(numberRefs).size === input.currentCourse.length)
      return numberRefs.every((number, index) => number === edit.indices[index]);
    const focus = resolveQuestionFocus(message, input.currentCourse.map((name, index) => ({ name, meta: input.currentCategories?.[index] ?? "" })));
    if (focus.invalid || focus.stops.length !== 1) return false;
    const target = input.currentCourse.indexOf(focus.stops[0].name) + 1;
    const remaining = input.currentCourse.map((_, index) => index + 1).filter(index => index !== target);
    const expected = /먼저|앞으로/.test(message) ? [target, ...remaining] : /마지막|뒤로/.test(message) ? [...remaining, target] : [];
    return expected.length > 0 && expected.every((number, index) => number === edit.indices[index]);
  }
  if (!/빼|삭제|제외|제거/.test(message) || /또는|혹은|중\s*(?:하나|한\s*곳)|만약/.test(message)) return false;
  const removalReferences = [...message.matchAll(/(?<!\d)(\d+\s*번(?:\s*(?:이랑|랑|하고|과|와|,|그리고|및)\s*\d+\s*번)*)(?:만|을|를|은|는|도)?\s*(?:빼(?!지)|삭제(?!하지)|제외(?!하지)|제거(?!하지))/g)]
    .flatMap(match => [...match[1].matchAll(/(\d+)\s*번/g)].map(number => Number(number[1])));
  const protectedReferences = [...message.matchAll(/(?<!\d)(\d+)\s*번(?:은|는|을|를|만)?\s*(?:빼지|삭제하지|제외하지|제거하지|유지|남겨)/g)].map(match => Number(match[1]));
  if (protectedReferences.some(index => edit.indices.includes(index))) return false;
  if (removalReferences.length) {
    const requested = [...new Set(removalReferences)];
    return requested.length === edit.indices.length && requested.every(index => edit.indices.includes(index));
  }
  // A negative or range expression needs an explicit clarification rather than a guess.
  if (/빼지|삭제하지|제외하지|제거하지|부터|까지|~/.test(message)) return false;
  const focus = resolveQuestionFocus(message, input.currentCourse.map((name, index) => ({ name, meta: input.currentCategories?.[index] ?? "" })));
  if (focus.invalid || !focus.stops.length || /하나|한\s*(?:곳|개)/.test(message) && focus.stops.length !== 1) return false;
  const requested = focus.stops.map(stop => input.currentCourse.indexOf(stop.name) + 1);
  return requested.length === edit.indices.length && requested.every(index => edit.indices.includes(index));
}
