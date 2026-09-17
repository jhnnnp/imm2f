import type { CouplePlan, PlanItem } from "./types/plan";

type TripArchive = {
  id: string;
  title: string;
  items: PlanItem[];
};

const DEMO_PLACE_IDS = new Set([
  "gunsan-history",
  "gunsan-chowon",
  "gunsan-hirotzu",
  "gunsan-dongguksa",
  "gunsan-railroad",
  "gunsan-eunpa",
  "gunsan-seonyudo",
  "gunsan-jangjado",
  "jeonju-hanok",
  "jeonju-cathedral",
  "jeonju-jaman",
  "busan-huinnyeoul",
  "busan-jagalchi",
  "busan-haeundae",
  "busan-cheongsapo",
]);

const DEMO_PLACE_NAMES = new Set([
  "군산근대역사박물관",
  "초원사진관",
  "신흥동 일본식가옥",
  "동국사",
  "경암동 철길마을",
  "은파호수공원",
  "선유도해수욕장",
  "장자도 전망대",
  "전주한옥마을",
  "전동성당",
  "자만벽화마을",
  "흰여울문화마을",
  "자갈치시장",
  "해운대 해수욕장",
  "청사포",
]);

const DEMO_MEMOS = new Set([
  "군산의 근대사와 항구 이야기를 먼저 살펴봐요.",
  "시간여행마을 골목과 영화의 장면을 천천히 걸어요.",
  "점심 뒤 고요한 정원과 오래된 건축을 둘러봐요.",
  "도심 속 사찰에서 여행의 속도를 잠시 낮춰요.",
  "철길을 따라 아침 산책과 사진을 남겨요.",
  "물가를 따라 걸으며 느긋한 오전을 보내요.",
  "고군산군도의 바다와 모래사장을 함께 걸어요.",
  "섬과 바다가 겹치는 노을로 여행을 마무리해요.",
  "한옥 골목을 천천히 걸었던 아침",
  "돌빛이 아름다웠던 성당",
  "언덕 위에서 바라본 한옥 지붕",
  "절벽 아래 푸른 바다를 따라 걸었어요.",
  "시장 골목에서 부산의 저녁을 맛봤어요.",
  "둘째 날 아침의 잔잔한 바다",
  "등대 사이로 내려앉은 노을",
]);

const DEMO_ITEM_ID = /^(gunsan-d[12]-\d|jeonju-\d|busan-\d)$/;
const DEMO_ARCHIVE_IDS = new Set(["archive-jeonju-2025", "archive-busan-2024"]);
const DEMO_TITLES = new Set(["군산에서 머문 이틀", "전주에서 천천히", "부산 바다의 이틀"]);
const DEMO_NOTES = "근대 골목에서 시작해 섬의 노을로 끝나는 1박 2일";

export function isLegacyDemoTripTitle(title: string) {
  return DEMO_TITLES.has(title.trim());
}

export function isLegacyDemoTripItem(item: Pick<PlanItem, "id" | "placeId" | "placeName" | "memo">, title = "") {
  const name = item.placeName.trim();
  const memo = (item.memo ?? "").trim();
  if (DEMO_ITEM_ID.test(item.id) || DEMO_PLACE_IDS.has(item.placeId) || DEMO_MEMOS.has(memo)) return true;
  if (DEMO_PLACE_NAMES.has(name) && (isLegacyDemoTripTitle(title) || DEMO_MEMOS.has(memo))) return true;
  return false;
}

function emptyDemoPlan(plan: CouplePlan): CouplePlan {
  return {
    ...plan,
    items: [],
    title: "",
    notes: "",
    startDate: null,
    dayCount: 1,
  };
}

export function stripLegacyDemoPlan(plan: CouplePlan): CouplePlan {
  if (isLegacyDemoTripTitle(plan.title) || plan.notes === DEMO_NOTES) return emptyDemoPlan(plan);
  const items = plan.items.filter(item => !isLegacyDemoTripItem(item, plan.title));
  if (items.length === plan.items.length) return plan;
  if (items.length) {
    return {
      ...plan,
      items,
      dayCount: Math.max(1, items.reduce((max, item) => Math.max(max, item.dayIndex + 1), 1)),
    };
  }
  return emptyDemoPlan(plan);
}

export function stripLegacyDemoArchive<T extends TripArchive>(journey: T): T | null {
  if (DEMO_ARCHIVE_IDS.has(journey.id) || isLegacyDemoTripTitle(journey.title)) return null;
  const items = journey.items.filter(item => !isLegacyDemoTripItem(item, journey.title));
  if (journey.items.length && items.length === 0) return null;
  if (!items.length && isLegacyDemoTripTitle(journey.title)) return null;
  return items.length === journey.items.length ? journey : { ...journey, items };
}
