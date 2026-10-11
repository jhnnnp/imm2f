import type { AIPlannerState } from "@/features/planning/types/plan";
import { extractAreasFromText, selectedAreas } from "./dateBrief";
import { isQuestion } from "./chatRoute";
import type { CandidateGroup, ExplorationCard } from "./candidateExploration";

export type ExplorationFollowUpIntent = "conditions" | "plan" | "question" | "refine";

/** Read-only questions must never silently change the search or discard a shortlist. */
export function explorationFollowUpIntent(message: string, state: AIPlannerState): ExplorationFollowUpIntent {
  const text = message.trim();
  const command = /바꿔\s*줘|변경해\s*줘|해\s*줘|짜\s*줘|만들어\s*줘|맞춰\s*줘|처음부터|새(?:로운)?\s*(?:여행|데이트|계획)/.test(text);
  const asks = /\?\s*$|될까|괜찮을까|어때|어떨까|좋을까|어떤가|차이|비교|왜|(?:몇\s*시|얼마|언제).*(?:야|예요|인가|알려)|가능(?:해|한가|할까)/.test(text);
  if (asks && !command) return "question";

  const writtenAreas = extractAreasFromText(text);
  const compactText = text.replace(/\s/g, "");
  const areaSearch = /추천|찾아|보여/.test(text) && writtenAreas.some(area => !selectedAreas(state).includes(area)
    && ["카페", "맛집", "식당", "전시", "야경", "공원", "체험", "쇼핑"].some(kind => compactText.includes(`${area}${kind}`)));
  const areaChanged = writtenAreas.some(area => !selectedAreas(state).includes(area))
    && (areaSearch || writtenAreas.includes(text) || /여행|데이트|지역|동네|행선지|목적지|으로|에서|쪽|갈래|가자|갈\s*거|바꿔|변경/.test(text));
  const paceCondition = /(?:일정|코스|동선|여행|하루).{0,15}(?:여유롭|느긋|빡빡|많이\s*둘러|빡세|쉬엄쉬엄)|(?:여유롭|느긋|빡빡|많이\s*둘러|쉬엄쉬엄).{0,12}(?:짜|만들|바꿔|해)/.test(text);
  const condition = paceCondition || /\d{1,2}\s*박|\d{1,2}\s*일\s*(?:여행|일정)|당일(?:치기|로)|하루\s*(?:만|데이트|일정|여행)|반나절|한나절|(?:알레르기|못\s*먹|먹지\s*못)|(?:도보|걸어서|차로|자차|렌터카|대중교통|버스|지하철).{0,15}(?:이동|갈|가자|가고|다닐|다녀|할게|다니|기준|바꿔|변경)|(?:\d{1,2}\s*시|\d{1,2}:\d{2}|오전|오후|저녁|아침|밤).{0,16}(?:시작|부터|까지|도착|출발|귀가|돌아|마무리)|(?:시작|도착|출발|귀가|종료)\s*(?:시간|시각).{0,15}\d|새(?:로운)?\s*(?:여행|데이트|계획)|처음부터/.test(text);
  if (areaChanged || condition) return "conditions";
  if ((/(?:일정|코스|동선)/.test(text) || /선택한\s*장소|고른\s*장소|이걸로|이거로|이곳들로|이\s*장소들로/.test(text))
    && /짜|만들|계획|확정|시작해/.test(text)) return "plan";
  if (isQuestion(text, false)) return "question";
  return "refine";
}

/** Keep numbering identical to the visible cards, including after rejection or page replacement. */
export function visibleExplorationCards(groups: CandidateGroup[], rejectedIds: string[]): ExplorationCard[] {
  const rejected = new Set(rejectedIds);
  const seen = new Set<string>();
  return groups.flatMap(group => group.cards).filter(card => {
    if (rejected.has(card.candidateId) || seen.has(card.candidateId)) return false;
    seen.add(card.candidateId);
    return true;
  });
}

export function explicitPlanningChoices(message: string, visible: ExplorationCard[], selected: ExplorationCard[]) {
  const numbers = [...message.matchAll(/(?<!\d)(\d+)\s*번/g)].map(match => Number(match[1]) - 1);
  const compact = (value: string) => value.replace(/\s/g, "").toLowerCase();
  const mentioned = visible.filter(card => compact(card.name).length >= 2 && compact(message).includes(compact(card.name)));
  const named = mentioned.filter(card => !mentioned.some(other => other !== card
    && compact(other.name) !== compact(card.name) && compact(other.name).includes(compact(card.name))));
  if (!numbers.length && !named.length) return { cards: null, invalid: false };
  if (numbers.some(index => index < 0 || index >= visible.length)) return { cards: null, invalid: true };
  const referenced = new Map([...numbers.map(index => visible[index]), ...named].map(card => [card.candidateId, card]));
  const removing = /빼|제외|삭제|제거/.test(message);
  // Mixed add/remove commands need a clearer choice rather than guessing which number is excluded.
  if (removing && /넣|추가|포함/.test(message)) return { cards: null, invalid: true };
  return { cards: removing ? selected.filter(card => !referenced.has(card.candidateId)) : [...referenced.values()], invalid: false };
}
