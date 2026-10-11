import type { AIPlannerState } from "@/features/planning/types/plan";

export function explicitlyDislikedActivities(message: string): AIPlannerState["activities"] {
  const patterns: Array<[AIPlannerState["activities"][number], RegExp]> = [
    ["cafe", /카페|커피|디저트/g],
    ["meal", /식사|식당|밥/g],
    ["walk", /산책|걷기/g],
    ["exhibit", /전시|미술관|박물관|갤러리/g],
    ["movie", /영화|영화관/g],
    ["performance", /공연|연극|뮤지컬|콘서트/g],
    ["indoor", /실내(?:\s*활동)?|방탈출|보드게임|볼링|오락실|만화카페|VR/g],
    ["nightview", /야경|전망대|루프탑/g],
  ];
  return patterns.filter(([, pattern]) => [...message.matchAll(pattern)].some(match => {
    if (/[가-힣A-Za-z0-9]$/.test(message.slice(0, match.index))) return false;
    if (/(?:^|\s)(?:그|이|저|지금|현재)\s*$/.test(message.slice(0, match.index))) return false;
    const tail = message.slice(match.index + match[0].length);
    return /^\s*(?:은|는|을|를|이|가|도|만)?\s*(?:별로\s*)?(?:싫|별로|안\s*좋아|빼|제외|말고|안\s*가|가지\s*마|필요\s*없)/.test(tail)
      && !/^.{0,20}(?:싫지\s*않|안\s*좋아하는\s*(?:건|것은)?\s*아니)/.test(tail);
  })).map(([activity]) => activity);
}
