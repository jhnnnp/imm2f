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

const DEMO_ITEM_ID = /^(gunsan-d[12]-\d|jeonju-\d|busan-\d)$/;
const DEMO_ARCHIVE_IDS = new Set(["archive-jeonju-2025", "archive-busan-2024"]);
const DEMO_TITLES = new Set(["군산에서 머문 이틀", "전주에서 천천히", "부산 바다의 이틀"]);

export function isLegacyDemoTripTitle(title: string) {
  return DEMO_TITLES.has(title.trim());
}

export function isLegacyDemoTripItem(item: Pick<PlanItem, "id" | "placeId" | "placeName" | "memo">) {
  return DEMO_ITEM_ID.test(item.id) && DEMO_PLACE_IDS.has(item.placeId);
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
  const items = plan.items.filter(item => !isLegacyDemoTripItem(item));
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
  if (DEMO_ARCHIVE_IDS.has(journey.id)) return null;
  const items = journey.items.filter(item => !isLegacyDemoTripItem(item));
  if (journey.items.length && items.length === 0) return null;
  return items.length === journey.items.length ? journey : { ...journey, items };
}
