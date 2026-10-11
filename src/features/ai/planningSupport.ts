import { extractStay } from "./dateBrief";

/** Current itinerary engine supports domestic local dates and trips up to seven days. */
export function unsupportedCourseRequest(message: string) {
  const abroad = /해외|국외/.test(message)
    || (/(?:여행|당일치기|\d+\s*박|(?:에서|으로|로)\s*(?:데이트|코스|일정))/.test(message)
      && /일본(?!식)|도쿄|오사카|교토|후쿠오카|미국(?!식)|뉴욕|파리(?!바게)|프랑스|유럽|대만(?!식)|타이베이|베트남|태국|방콕|홍콩(?!반점)|싱가포르/.test(message));
  if (abroad)
    return "현재 장소·관광 정보 검증은 국내 코스에 한정돼 있어요. 해외 장소를 확인하지 않은 채 여행 코스를 만들지 않을게요.";
  const explicitStay = extractStay(message);
  const activeNights = [...message.matchAll(/(\d+)\s*박(?:\s*\d+\s*일)?/g)]
    .filter(match => !/^\s*(?:은|는|을|를)?\s*(?:말고|대신|취소|제외)/.test(message.slice(match.index! + match[0].length))).at(-1);
  const requestedNights = explicitStay?.nights ?? Number(activeNights?.[1] ?? 0);
  if (requestedNights > 6) {
    return `현재 여행 코스는 최대 6박 7일까지 검증할 수 있어요. ${requestedNights}박 일정을 임의로 줄이지 않을게요. 먼저 6박 7일 이내 구간을 지정해 주세요.`;
  }
  return null;
}

function clockFromKorean(raw: string) {
  const digital = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (digital) return `${digital[1].padStart(2, "0")}:${digital[2]}`;
  const match = raw.match(/(오전|오후|아침|점심|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(?:(\d{1,2})\s*분|(반)))?/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = match[4] ? 30 : Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || (match[1] && (hour < 1 || hour > 12))) return null;
  if (!match[1] && hour <= 12) return null;
  if (/오후|점심|저녁/.test(match[1] ?? "") && hour < 12) hour += 12;
  if (match[1] === "밤") hour = hour === 12 ? 0 : hour + 12;
  if (/오전|아침|새벽/.test(match[1] ?? "") && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Only explicit local arrival/departure times constrain the first/last day.
 * Train/bus travel from the origin and lodging transfers still need routing. */
export function tripLocalWindows(requests: string[], days: number) {
  if (days < 2) return {} as Record<number, { start?: string; end?: string }>;
  const windows: Record<number, { start?: string; end?: string }> = {};
  for (const request of requests) {
    const clauses = request.split(/[,，。\n;；.!?]|(?:그리고|그다음)/);
    for (const clause of clauses) {
      // Pair each movement with its immediately preceding clock. A sentence
      // can contain both arrival and departure with different times.
      const movements = [...clause.matchAll(/(?:도착|출발|귀가|돌아(?:가|오)?)/g)];
      let previousEnd = 0;
      for (const movement of movements) {
        const fragment = clause.slice(previousEnd, movement.index! + movement[0].length);
        previousEnd = movement.index! + movement[0].length;
        const clocks = [...fragment.matchAll(/(?:\b(?:[01]?\d|2[0-3]):[0-5]\d\b|(?:오전|오후|아침|점심|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*(?:\d{1,2}\s*분|반))?)/g)];
        const clock = clocks.length ? clockFromKorean(clocks.at(-1)![0]) : null;
        if (!clock) continue;
        const namedOtherDay = /(?:[2-9]\s*일차|둘째\s*날|셋째\s*날|마지막\s*날|막날)/.test(fragment);
        const namedFirstDay = /첫(?:째)?\s*날|1\s*일차/.test(fragment);
        if (movement[0] === "도착" && !namedOtherDay)
          windows[0] = { ...windows[0], start: clock };
        const namedLastDay = /마지막\s*날|막날/.test(fragment)
          || new RegExp(`${days}\\s*일차`).test(fragment)
          || (days === 2 && /둘째\s*날|이튿날/.test(fragment))
          || (days === 3 && /셋째\s*날/.test(fragment));
        const departure = movement[0] !== "도착";
        if (departure && (namedLastDay || !namedFirstDay && /귀가|돌아|현지\s*출발/.test(fragment)))
          windows[days - 1] = { ...windows[days - 1], end: clock };
      }
    }
  }
  return windows;
}
