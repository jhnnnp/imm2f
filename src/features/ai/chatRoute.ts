import type { AIPlannerState, PlaceAsk, PlaceAskKind } from "@/features/planning/types/plan";
import { extractAreasFromText, extractCuisine, isTravelArea, selectedAreas, uniqueStrings } from "@/features/ai/dateBrief";
import { isCourseQuickAction, isRedoRequest, isSoftReroll, isSwapRequest } from "@/features/ai/dateCourse";

/**
 * Which kind of turn the user just took. The date-course pipeline is only one
 * of them; the others answer directly so the chat does not force a course on
 * "성수 파스타 맛집 추천해줘" or "여기 주차 돼?".
 */
export type ChatMode = "course" | "places" | "question" | "chat";

export type ChatRoute = {
  edit?: { kind: "retime" | "remove" | "reorder"; indices: number[] };
  mode: ChatMode;
  /** True when the local rules alone are sure; the LLM router is skipped. */
  confident: boolean;
  placeAsk?: PlaceAsk | null;
  /** Shown places the user picked for a course ("1번이랑 3번으로 코스 짜줘"). */
  pickedPlaces?: string[];
};

export const PLACE_KIND_LABEL: Record<PlaceAskKind, string> = {
  restaurant: "식당",
  cafe: "카페",
  bar: "술집",
  dessert: "디저트",
  exhibit: "전시",
  activity: "놀거리",
  spot: "장소",
};

function objectParticle(word: string) {
  const last = word.charCodeAt(word.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? "을" : "를";
}

const FOOD_NOUN = /맛집|식당|음식점|밥집|레스토랑|먹을\s*(?:곳|데|만한)|(?:저녁|점심|아침|밥)\s*(?:먹|식사)|식사할|한식|일식|중식|양식|파스타|피자|초밥|스시|오마카세|라멘|우동|돈카츠|고기|삼겹|갈비|한우|곱창|국밥|찌개|브런치|스테이크|햄버거|버거|샐러드|타코|쌀국수|마라|딤섬|짜장|짬뽕|족발|보쌈|치킨|회\s*(?:먹|한\s*접시)|횟집|모둠회|해물|해산물|냉면|칼국수|만두|떡볶이|카레|덮밥|비건|채식/;
const CAFE_NOUN = /카페|커피|디저트|베이커리|빵집|케이크|마카롱|젤라또|아이스크림|티룸|찻집|와플|도넛|타르트|크로플|소금빵/;
const BAR_NOUN = /술집|와인바|와인|칵테일|루프탑바|이자카야|맥주|펍|포차|하이볼|사케|위스키|막걸리|전통주|한잔/;
const EXHIBIT_NOUN = /전시|미술관|갤러리|박물관|팝업|팝업스토어|공연|연극|뮤지컬|영화관|미디어아트/;
const ACTIVITY_NOUN = /놀거리|방탈출|보드게임|볼링|오락실|만화카페|VR|공방|클래스|체험|노래방|피크닉|공원|산책|야경|전망대|루프탑/;
const ASK_VERB = /추천|알려|어디|어때|있어|있나|있을까|찾아|소개|골라|뭐가\s*좋|맛있는|유명한|괜찮은|잘\s*하는|핫한|인기|리스트|목록|어디가\s*좋|좋은\s*(?:곳|데)|갈만한|가볼만한|먹을\s*(?:곳|데|만한)|마실\s*(?:곳|데)|볼만한|어디\s*(?:갈|가)|몇\s*곳|몇\s*개/;
const COURSE_WORD = /코스|일정|동선|짜\s*줘|짜줘|짜\s*봐|짜주|계획|플랜|하루\s*(?:를|을)?\s*(?:보내|채워)|데이트\s*(?:하고|할|하자|가자|짜)|여행\s*(?:가|하|짜|일정)|1박|2박|당일치기|오후부터|저녁부터|밤부터|스케줄|루트/;
const QUESTION_WORD = /주차|영업\s*시간|몇\s*시(?:까지|부터|에)|언제\s*(?:열|닫|까지)|휴무|브레이크\s*타임|예약|웨이팅|줄\s*서|예산|얼마|가격|비싸|저렴|메뉴\s*(?:가|는|뭐|추천)|뭐가\s*유명|시그니처|대표\s*메뉴|왜\s*(?:골랐|추천|여기)|차이|비교|어느\s*(?:게|쪽)|둘\s*중|뭐가\s*(?:더|나)|비\s*오면|날씨|가는\s*법|어떻게\s*가|지하철|버스|택시|거리|멀어|가까워|걸어서|몇\s*분|소요|애견|반려|아이|유아|휠체어|콜키지|주류|와이파이|콘센트|노키즈|룸\s*있|단체|기념일|프로포즈|선물|뭐\s*입|옷/;
const MORE_WORD = /다른\s*(?:곳|데|집|가게)|더\s*(?:보여|알려|추천|찾아)|또\s*(?:있|없)|다른\s*거|다른\s*(?:것|건)|더\s*없|다음/;
const PICK_FROM_SHOWN = /이\s*중(?:에서|에)?|여기\s*중|위\s*(?:에서|중)|이걸로|이거로|얘로|여기로|이\s*집(?:으로|들로)?|얘들로|이곳으로|여기랑|번(?:이랑|하고|과|,|\s)|번으로|번\s*(?:가|갈|넣)/;

export function detectPlaceKind(message: string): PlaceAskKind | null {
  if (BAR_NOUN.test(message)) return "bar";
  if (CAFE_NOUN.test(message)) {
    return /디저트|케이크|마카롱|젤라또|아이스크림|와플|도넛|타르트|크로플/.test(message) && !/카페|커피/.test(message) ? "dessert" : "cafe";
  }
  if (FOOD_NOUN.test(message)) return "restaurant";
  if (EXHIBIT_NOUN.test(message)) return "exhibit";
  if (ACTIVITY_NOUN.test(message)) return "activity";
  if (/(?:갈|가볼|놀|볼)\s*(?:만한|만\s*한)\s*(?:곳|데)|스팟|명소|핫플/.test(message)) return "spot";
  return null;
}

const CUISINE_LIKE = /(파스타|피자|초밥|스시|오마카세|라멘|우동|돈카츠|삼겹|갈비|한우|곱창|국밥|찌개|브런치|스테이크|햄버거|버거|샐러드|타코|쌀국수|마라|딤섬|짜장|짬뽕|족발|보쌈|치킨|횟집|해물|해산물|냉면|칼국수|만두|떡볶이|카레|덮밥|비건|채식|와인|칵테일|이자카야|맥주|하이볼|사케|위스키|막걸리|전통주|디저트|베이커리|빵집|케이크|마카롱|젤라또|아이스크림|티룸|찻집|와플|도넛|타르트|크로플|소금빵|전시|미술관|갤러리|박물관|팝업|방탈출|보드게임|볼링|만화카페|VR|공방|클래스|루프탑|야경|전망대|피크닉|고기|회)/g;

export function placeQueryFromMessage(message: string, kind: PlaceAskKind) {
  const words = uniqueStrings([...message.matchAll(CUISINE_LIKE)].map(match => match[1]), 3);
  if (words.length) return words.join(" ");
  const cuisine = extractCuisine(message);
  if (cuisine && cuisine !== "any") return cuisine;
  if (kind === "restaurant") return "맛집";
  if (kind === "cafe") return "카페";
  if (kind === "bar") return "술집";
  if (kind === "dessert") return "디저트";
  if (kind === "exhibit") return "전시";
  if (kind === "activity") return "놀거리";
  return "명소";
}

function resolveArea(message: string, state: AIPlannerState | undefined) {
  const extracted = extractAreasFromText(message);
  if (extracted.length) return extracted[0];
  return state ? selectedAreas(state)[0] ?? "" : "";
}

export function isPlaceRequest(message: string) {
  if (COURSE_WORD.test(message)) return false;
  const kind = detectPlaceKind(message);
  if (!kind) return false;
  return ASK_VERB.test(message) || /먹고\s*싶|마시고\s*싶|먹을까|마실까|보고\s*싶|가고\s*싶/.test(message);
}

/** A request for a sequence of different experiences needs a course, not a list of one venue type. */
function isMultiStopRequest(message: string) {
  const kinds = [FOOD_NOUN, CAFE_NOUN, BAR_NOUN, EXHIBIT_NOUN, ACTIVITY_NOUN]
    .filter(pattern => pattern.test(message)).length;
  return kinds >= 2
    && /(?:먹|마시|보|가|들르|걷|산책|식사).{0,25}(?:고|다음|후에|들렀다가|거쳐|이어|→)/.test(message)
    && !/비교|차이|어느\s*(?:게|쪽)|뭐가\s*더/.test(message);
}

export function isMoreRequest(message: string) {
  return MORE_WORD.test(message) && !COURSE_WORD.test(message);
}

export function isQuestion(message: string, hasCourse: boolean) {
  if (COURSE_WORD.test(message) && !/왜|얼마|주차|예약|웨이팅|영업/.test(message)) return false;
  if (QUESTION_WORD.test(message)) return true;
  if (!hasCourse) return false;
  return /\?\s*$/.test(message) && !isPlaceRequest(message) && !ASK_VERB.test(message);
}

function shownNameMentioned(message: string, name: string, siblings: string[]) {
  const msg = message.replace(/\s/g, "").toLowerCase();
  const compact = name.replace(/\s/g, "").toLowerCase();
  if (compact.length >= 2 && msg.includes(compact)) return true;
  if (compact.length < 6) return false;
  const prefix = compact.slice(0, 5);
  if (!msg.includes(prefix)) return false;
  return siblings.filter(other => other.replace(/\s/g, "").toLowerCase().startsWith(prefix)).length === 1;
}

export function pickedShownPlaces(message: string, shownPlaces: string[]) {
  const byName = shownPlaces.filter(name => shownNameMentioned(message, name, shownPlaces));
  const numbers = [...message.matchAll(/(\d{1,2})\s*번/g)]
    .map(match => Number(match[1]))
    .filter(number => number >= 1 && number <= shownPlaces.length)
    .map(number => shownPlaces[number - 1]);
  const first = /첫\s*(?:번째|째)|첫\s*집|처음\s*(?:거|것|곳)/.test(message) ? [shownPlaces[0]] : [];
  const second = /두\s*(?:번째|째)/.test(message) ? [shownPlaces[1]] : [];
  const third = /세\s*(?:번째|째)/.test(message) ? [shownPlaces[2]] : [];
  return uniqueStrings([...byName, ...numbers, ...first, ...second, ...third].filter((name): name is string => Boolean(name)), 4);
}

/**
 * Local routing. Pure so the UI can reuse it for the typing indicator, and so
 * tests do not need the LLM. The LLM router only runs on `confident: false`.
 */
export function routeDateChatLocally(input: {
  message: string;
  state?: AIPlannerState;
  hasCourse: boolean;
  chatSituation: string | null;
}): ChatRoute {
  const message = input.message.trim();
  const shown = input.state?.shownPlaces ?? [];
  if (!message) return { mode: "course", confident: true };
  if (input.chatSituation) return { mode: "chat", confident: true };
  // A typed area answer must resume the same search, just like an area chip.
  const pendingAsk = input.state?.placeAsk;
  const writtenAreas = extractAreasFromText(message);
  if (pendingAsk && !pendingAsk.area && writtenAreas.length && !COURSE_WORD.test(message) && !isMultiStopRequest(message)) {
    const kind = detectPlaceKind(message) ?? pendingAsk.kind;
    return {
      mode: "places",
      confident: true,
      placeAsk: {
        kind,
        query: detectPlaceKind(message) ? placeQueryFromMessage(message, kind) : pendingAsk.query,
        area: writtenAreas[0],
      },
    };
  }
  if (isCourseQuickAction(message)) return { mode: "course", confident: true };
  const discussingEdit = /왜.*(?:바뀌|바꿨|변경|빠졌|삭제)|(?:바꾸|바꿔|교체|변경|빼|제외|추가|대신).*(?:할까|될까|어때|좋을까|됐|된\s*거|했어|했나요)/.test(message);
  const commandsEdit = /해\s*줘|해\s*주|바꿔\s*줘|빼\s*줘|넣어\s*줘|고쳐|짜\s*줘/.test(message);
  if (discussingEdit && !commandsEdit) return { mode: "question", confident: true };
  if (input.hasCourse && (isSwapRequest(message) || isRedoRequest(message) || isSoftReroll(message) || /빼\s*줘|제외|한\s*곳\s*더|추가해/.test(message))) {
    return { mode: "course", confident: true };
  }
  if (shown.length && (PICK_FROM_SHOWN.test(message) || pickedShownPlaces(message, shown).length) && COURSE_WORD.test(message)) {
    return { mode: "course", confident: true, pickedPlaces: pickedShownPlaces(message, shown) };
  }
  if (shown.length && input.state?.placeAsk && isMoreRequest(message) && !detectPlaceKind(message)) {
    return { mode: "places", confident: true, placeAsk: { ...input.state.placeAsk, area: writtenAreas[0] || input.state.placeAsk.area } };
  }
  // Questions about a referenced venue must not become another venue search.
  const referencesPlace = /(?:이|그|저)\s*(?:카페|식당|곳|장소)|거기|\d+\s*번|첫\s*번째|두\s*번째|세\s*번째|마지막/.test(message)
    || shown.some(name => message.replace(/\s/g, "").includes(name.replace(/\s/g, "")));
  if (referencesPlace && QUESTION_WORD.test(message)) return { mode: "question", confident: true };
  if (input.hasCourse && /^(?:(?:그|이)\s*)?(?:식당|카페|공연장|전시)\s*(?:은|는|이|가)?\s*(?:어때|괜찮아|좋아|어떤데)\??$/.test(message)) {
    return { mode: "question", confident: true };
  }
  if (isMultiStopRequest(message)) return { mode: "course", confident: true };
  if (isPlaceRequest(message)) {
    const kind = detectPlaceKind(message) ?? "spot";
    const area = resolveArea(message, input.state);
    return {
      mode: "places",
      confident: true,
      placeAsk: { kind, query: placeQueryFromMessage(message, kind), area },
    };
  }
  if (isQuestion(message, input.hasCourse)) return { mode: "question", confident: true };
  if (COURSE_WORD.test(message) || extractAreasFromText(message).length) return { mode: "course", confident: true };
  if (shown.length && input.state?.placeAsk && detectPlaceKind(message)) {
    const kind = detectPlaceKind(message) ?? input.state.placeAsk.kind;
    return {
      mode: "places",
      confident: false,
      placeAsk: { kind, query: placeQueryFromMessage(message, kind), area: input.state.placeAsk.area },
    };
  }
  if (/\?\s*$/.test(message) || /어때|어떨까|뭐가|어떻게|왜|얼마|언제/.test(message)) {
    return { mode: "question", confident: false };
  }
  // An opaque acknowledgement or complaint must not silently replace a course.
  return { mode: "chat", confident: false };
}

/** Short status line shown under the typing indicator while the server works. */
export function pendingLabelFor(message: string, hasCourse: boolean, state?: AIPlannerState) {
  const route = routeDateChatLocally({ message, state, hasCourse, chatSituation: null });
  if (route.mode === "places") {
    const kind = route.placeAsk?.kind ?? "spot";
    const area = route.placeAsk?.area;
    const label = PLACE_KIND_LABEL[kind];
    return `${area ? `${area} ` : ""}${label}${objectParticle(label)} 찾아보고 후기를 확인하는 중입니다.`;
  }
  if (route.mode === "question") return "질문을 읽고 답을 정리하는 중입니다.";
  if (route.mode === "chat") return "답변을 준비하는 중입니다.";
  if (hasCourse) return "코스를 다시 맞추는 중입니다.";
  return "근처 장소를 찾고 동선을 맞추는 중입니다.";
}

export function placeAskArea(ask: PlaceAsk | null | undefined, state: AIPlannerState | undefined) {
  const area = ask?.area || (state ? selectedAreas(state)[0] : "") || "";
  return { area, travel: area ? isTravelArea(area) : false };
}
