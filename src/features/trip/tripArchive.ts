import type { PlanItem } from "@/features/planning/types/plan";

export type TripJourney = {
  id: string;
  title: string;
  startDate: string;
  dayCount: number;
  status: "completed";
  items: PlanItem[];
};

const ARCHIVE_KEY = "only-us-trip-archive";
const ARCHIVE_EVENT = "only-us-trip-archive-change";

const DEMO_PAST_TRIPS: TripJourney[] = [
  {
    id: "archive-jeonju-2025",
    title: "전주에서 천천히",
    startDate: "2025-10-18",
    dayCount: 1,
    status: "completed",
    items: [
      { id: "jeonju-1", placeId: "jeonju-hanok", placeName: "전주한옥마을", category: "한옥 산책", startTime: "10:00", durationMinutes: 100, expectedCost: 0, order: 0, memo: "한옥 골목을 천천히 걸었던 아침", dayIndex: 0, coordinates: [127.153, 35.815] },
      { id: "jeonju-2", placeId: "jeonju-cathedral", placeName: "전동성당", category: "건축", startTime: "12:00", durationMinutes: 40, expectedCost: 0, order: 1, memo: "돌빛이 아름다웠던 성당", dayIndex: 0, coordinates: [127.1493, 35.8134] },
      { id: "jeonju-3", placeId: "jeonju-jaman", placeName: "자만벽화마을", category: "골목", startTime: "15:00", durationMinutes: 70, expectedCost: 0, order: 2, memo: "언덕 위에서 바라본 한옥 지붕", dayIndex: 0, coordinates: [127.1588, 35.8165] },
    ],
  },
  {
    id: "archive-busan-2024",
    title: "부산 바다의 이틀",
    startDate: "2024-05-03",
    dayCount: 2,
    status: "completed",
    items: [
      { id: "busan-1", placeId: "busan-huinnyeoul", placeName: "흰여울문화마을", category: "바다 골목", startTime: "11:00", durationMinutes: 100, expectedCost: 0, order: 0, memo: "절벽 아래 푸른 바다를 따라 걸었어요.", dayIndex: 0, coordinates: [129.0437, 35.0787] },
      { id: "busan-2", placeId: "busan-jagalchi", placeName: "자갈치시장", category: "시장", startTime: "15:00", durationMinutes: 80, expectedCost: 0, order: 1, memo: "시장 골목에서 부산의 저녁을 맛봤어요.", dayIndex: 0, coordinates: [129.0305, 35.0967] },
      { id: "busan-3", placeId: "busan-haeundae", placeName: "해운대 해수욕장", category: "해변", startTime: "10:00", durationMinutes: 90, expectedCost: 0, order: 2, memo: "둘째 날 아침의 잔잔한 바다", dayIndex: 1, coordinates: [129.1604, 35.1587] },
      { id: "busan-4", placeId: "busan-cheongsapo", placeName: "청사포", category: "노을", startTime: "16:30", durationMinutes: 80, expectedCost: 0, order: 3, memo: "등대 사이로 내려앉은 노을", dayIndex: 1, coordinates: [129.191, 35.16] },
    ],
  },
];

export function getArchivedTrips(): TripJourney[] {
  if (typeof window === "undefined") return DEMO_PAST_TRIPS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ARCHIVE_KEY) || "[]") as TripJourney[];
    const saved = Array.isArray(parsed) ? parsed : [];
    return [...saved, ...DEMO_PAST_TRIPS.filter(demo => !saved.some(item => item.id === demo.id))];
  } catch {
    return DEMO_PAST_TRIPS;
  }
}

export function archiveTrip(input: Omit<TripJourney, "id" | "status">) {
  if (typeof window === "undefined") return;
  const next: TripJourney = { ...input, id: `archive-${Date.now()}`, status: "completed" };
  const existing = getArchivedTrips().filter(item => !item.id.startsWith("archive-jeonju-") && !item.id.startsWith("archive-busan-"));
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify([next, ...existing]));
  window.dispatchEvent(new Event(ARCHIVE_EVENT));
}

export function subscribeTripArchive(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(ARCHIVE_EVENT, listener);
  return () => window.removeEventListener(ARCHIVE_EVENT, listener);
}
