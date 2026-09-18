import type { DateActivityId, DateAreaScope, DateCuisine, DateTimeWindow } from "@/features/planning/types/plan";
import { TASTE_AREA_CATALOG, flattenRegionAreas } from "./areaCatalog";
import { DATE_INDOOR_OPTIONS } from "@/features/ai/dateBrief";
import type { TasteBudget, TasteCrowd, TasteCuisine, TasteDateFlow, TasteDrink, TastePace, TasteSetting } from "./types";

export { TASTE_AREA_CATALOG } from "./areaCatalog";
export type {
  TasteAreaRegion,
  TasteAreaScope,
  TasteAreaSection,
  TasteAreaSpot,
} from "./areaCatalog";

export const TASTE_AREA_GROUPS = TASTE_AREA_CATALOG.map(region => ({
  id: region.id,
  label: region.label,
  hint: region.hint,
  areas: flattenRegionAreas(region),
}));

export const TASTE_AREA_OPTIONS = [...new Set(TASTE_AREA_GROUPS.flatMap(group => group.areas))];

const AREA_ALIAS: Record<string, string> = {
  성수동: "성수",
  성수역: "성수",
  서울숲역: "서울숲",
  뚝섬유원지: "뚝섬",
  홍대입구: "홍대",
  홍대앞: "홍대",
  홍대입구역: "홍대",
  연남동: "연남",
  합정역: "합정",
  합정한강: "망원",
  망원한강: "망원",
  망원동: "망원",
  망리단: "망리단길",
  상수: "홍대",
  서교: "홍대",
  연트럴파크: "홍대",
  경의선숲길: "홍대",
  동교: "연남",
  연희: "연남",
  서강: "연남",
  공덕: "마포",
  대흥: "마포",
  효창: "마포",
  이대: "신촌",
  성산동: "상암",
  DMC: "상암",
  상암DMC: "상암",
  월드컵: "월드컵공원",
  한남동: "한남",
  이태원동: "이태원",
  익선: "익선동",
  을지로3가: "을지로",
  을지로5가: "을지로",
  을지로입구: "을지로",
  을지로입구역: "을지로",
  필동: "을지로",
  종각: "광장시장",
  회현: "명동",
  남대문: "명동",
  신당: "동대문",
  약수: "동대문",
  가로수: "신사",
  가로수길: "신사",
  도산공원: "신사",
  학동: "압구정",
  코엑스: "삼성",
  선릉: "역삼",
  신논현: "논현",
  언주: "논현",
  봉은사: "논현",
  선정릉: "논현",
  교대: "서초",
  방배: "서초",
  삼청: "북촌",
  가회동: "북촌",
  계동: "북촌",
  재동: "북촌",
  통인동: "서촌",
  경복궁: "서촌",
  자하: "서촌",
  옥인: "서촌",
  누하: "서촌",
  산림동: "익선동",
  입정동: "익선동",
  관수: "익선동",
  안국: "인사동",
  세종: "광화문",
  종로3가: "종로",
  시청: "광화문",
  덕수궁: "광화문",
  충정로: "광화문",
  창경궁: "창덕궁",
  낙산: "창덕궁",
  부암동: "창덕궁",
  송파: "송파",
  제주도: "제주",
  해운대해수욕장: "해운대",
  화양동: "화양",
  보광동: "보광",
  가회: "북촌",
  통인: "서촌",
  부암: "창덕궁",
  북촌한옥: "북촌",
  서울숲공원: "서울숲",
  롯데월드: "잠실",
  여의도공원: "여의도",
  강남역: "강남",
  판교역: "판교",
  분당역: "분당",
  신논현역: "논현",
  잠실새내: "잠실",
  잠실역: "잠실",
  혜화역: "혜화",
  코엑스몰: "삼성",
  반포한강: "반포",
  반포한강공원: "반포",
  경복궁역: "서촌",
  광화문광장: "광화문",
  마포성산: "상암",
  성신여대: "성신",
  건대: "건대입구",
  제주시: "제주",
  서귀포시: "서귀포",
  남포: "남포동",
  광안: "광안리",
  송정해수욕장: "다대포",
  화성행궁: "행궁",
  수원화성: "수원",
  동탄신도시: "동탄",
  일산호수: "일산",
  라페스타: "일산",
  헤이리마을: "헤이리",
  송도국제: "송도",
  영종도: "영종",
  강릉커피: "강릉",
  성산일출: "성산",
};

export function areaGroupId(area: string) {
  const canonical = canonicalizeArea(area);
  if (!canonical) return "";
  return TASTE_AREA_GROUPS.find(group => group.areas.includes(canonical))?.id ?? "";
}

export const TASTE_PACE_OPTIONS: ReadonlyArray<{ id: TastePace; label: string; hint: string }> = [
  { id: "linger", label: "한곳에 오래", hint: "카페나 식당에서 시간이 흘러도 괜찮아요" },
  { id: "mixed", label: "느긋하게 두세 곳", hint: "걷되 일정은 빡세지 않게" },
  { id: "walk", label: "많이 걸으며", hint: "골목과 풍경을 이어서 보고 싶어요" },
];

export const TASTE_ACTIVITY_OPTIONS: ReadonlyArray<{ id: DateActivityId; label: string }> = [
  { id: "meal", label: "식사" },
  { id: "cafe", label: "카페" },
  { id: "walk", label: "산책" },
  { id: "exhibit", label: "전시" },
  { id: "indoor", label: "실내 놀이" },
  { id: "nightview", label: "야경" },
];

export const TASTE_CUISINE_OPTIONS: ReadonlyArray<{ id: TasteCuisine; label: string }> = [
  { id: "한식", label: "한식" },
  { id: "일식", label: "일식" },
  { id: "중식", label: "중식" },
  { id: "양식", label: "양식" },
  { id: "any", label: "상관없음" },
];

export const TASTE_AVOID_OPTIONS = [
  "매운 음식",
  "해산물",
  "회",
  "내장",
  "양고기",
  "고깃집",
  "줄 서는 맛집",
  "술",
] as const;

export const TASTE_SETTING_OPTIONS: ReadonlyArray<{ id: TasteSetting; label: string }> = [
  { id: "indoor", label: "실내가 편해요" },
  { id: "outdoor", label: "바깥 공기가 좋아요" },
  { id: "mix", label: "둘 다 좋아요" },
];

export const TASTE_CROWD_OPTIONS: ReadonlyArray<{ id: TasteCrowd; label: string }> = [
  { id: "quiet", label: "한적한 골목" },
  { id: "lively", label: "북적이는 거리" },
  { id: "mix", label: "분위기는 유연하게" },
];

export const TASTE_BUDGET_OPTIONS: ReadonlyArray<{ id: TasteBudget; label: string; hint: string }> = [
  { id: "modest", label: "부담 없이", hint: "둘이 가볍게" },
  { id: "comfortable", label: "적당히", hint: "특별한 날 정도는 괜찮아요" },
  { id: "generous", label: "오늘은 잘", hint: "코스에 돈을 더 써도 돼요" },
];

export const TASTE_TIME_OPTIONS: ReadonlyArray<{ id: DateTimeWindow; label: string }> = [
  { id: "afternoon", label: "오후부터" },
  { id: "evening", label: "저녁부터" },
  { id: "night", label: "밤부터" },
  { id: "any", label: "상관없음" },
];

export const TASTE_SCOPE_OPTIONS: ReadonlyArray<{ id: DateAreaScope; label: string }> = [
  { id: "core", label: "이 동네 안에서만" },
  { id: "walkable", label: "걸어갈 주변까지" },
  { id: "nearby", label: "한 정거장 정도는 괜찮아요" },
];

export const TASTE_DATE_FLOW_OPTIONS: ReadonlyArray<{ id: TasteDateFlow; label: string; hint: string }> = [
  { id: "meal_first", label: "식사 먼저", hint: "밥 먹고 산책·전시" },
  { id: "cafe_first", label: "카페·가벼운 것 먼저", hint: "앉았다가 저녁" },
  { id: "flex", label: "그때그때", hint: "날씨·기분에 맞춰" },
];

export const TASTE_DRINK_OPTIONS: ReadonlyArray<{ id: TasteDrink; label: string }> = [
  { id: "none", label: "안 마셔요" },
  { id: "light", label: "가볍게 한잔" },
  { id: "any", label: "와인·맥주도 괜찮아요" },
];

export const TASTE_INDOOR_OPTIONS = DATE_INDOOR_OPTIONS;

export function canonicalizeArea(value: string) {
  const trimmed = value.trim().replace(/\s+/g, "");
  if (!trimmed) return "";
  return AREA_ALIAS[trimmed] ?? trimmed;
}

export function labelForPace(id: TastePace) {
  return TASTE_PACE_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForActivity(id: DateActivityId) {
  return TASTE_ACTIVITY_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForCuisine(id: TasteCuisine | DateCuisine) {
  return TASTE_CUISINE_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForSetting(id: TasteSetting) {
  return TASTE_SETTING_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForCrowd(id: TasteCrowd) {
  return TASTE_CROWD_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForBudget(id: TasteBudget) {
  return TASTE_BUDGET_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForTime(id: DateTimeWindow) {
  return TASTE_TIME_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForScope(id: DateAreaScope) {
  return TASTE_SCOPE_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForDateFlow(id: TasteDateFlow) {
  return TASTE_DATE_FLOW_OPTIONS.find(item => item.id === id)?.label ?? id;
}

export function labelForDrink(id: TasteDrink) {
  return TASTE_DRINK_OPTIONS.find(item => item.id === id)?.label ?? id;
}
