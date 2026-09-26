/** Current itinerary engine supports domestic local dates and trips up to three days. */
export function unsupportedCourseRequest(message: string) {
  const abroad = /해외|국외/.test(message)
    || (/(?:여행|당일치기|\d+\s*박|(?:에서|으로|로)\s*(?:데이트|코스|일정))/.test(message)
      && /일본(?!식)|도쿄|오사카|교토|후쿠오카|미국(?!식)|뉴욕|파리(?!바게)|프랑스|유럽|대만(?!식)|타이베이|베트남|태국|방콕|홍콩(?!반점)|싱가포르/.test(message));
  if (abroad)
    return "현재 장소·관광 정보 검증은 국내 코스에 한정돼 있어요. 해외 장소를 확인하지 않은 채 여행 코스를 만들지 않을게요.";
  const nights = [...message.matchAll(/(\d+)\s*박/g)].map(match => Number(match[1]));
  const longest = Math.max(0, ...nights);
  if (longest > 2) {
    return `현재 여행 코스는 최대 2박 3일까지 검증할 수 있어요. ${longest}박 일정을 임의로 2박으로 줄이지 않을게요. 먼저 2박 3일 구간을 지정해 주세요.`;
  }
  return null;
}

function clockFromKorean(raw: string) {
  const digital = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (digital) return `${digital[1].padStart(2, "0")}:${digital[2]}`;
  const match = raw.match(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || (match[1] && (hour < 1 || hour > 12))) return null;
  if (!match[1] && hour <= 12) return null;
  if (match[1] === "오후" && hour < 12) hour += 12;
  if (match[1] === "오전" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Only explicit local arrival/departure times constrain the first/last day.
 * Train/bus travel from the origin and lodging transfers still need routing. */
export function tripLocalWindows(requests: string[], days: number) {
  if (days < 2) return {} as Record<number, { start?: string; end?: string }>;
  const windows: Record<number, { start?: string; end?: string }> = {};
  for (const request of requests) {
    const clauses = request.split(/[,，。\n]|(?:그리고|그다음)/);
    for (const clause of clauses) {
      const clock = clockFromKorean(clause);
      if (!clock) continue;
      const namedOtherDay = /(?:[2-9]일차|둘째\s*날|셋째\s*날|마지막\s*날)/.test(clause);
      if (/도착/.test(clause) && !namedOtherDay)
        windows[0] = { ...windows[0], start: clock };
      const namedLastDay = /마지막\s*날/.test(clause)
        || new RegExp(`${days}\\s*일차`).test(clause)
        || (days === 2 && /둘째\s*날|이튿날/.test(clause))
        || (days === 3 && /셋째\s*날/.test(clause));
      if ((namedLastDay || /귀가|돌아|현지\s*출발/.test(clause)) && /출발|귀가|돌아/.test(clause))
        windows[days - 1] = { ...windows[days - 1], end: clock };
    }
  }
  return windows;
}
