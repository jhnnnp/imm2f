import type { PlanItem } from "@/features/planning/types/plan";

export type DateMemory = {
  id: string;
  title: string;
  date: string;
  notes: string;
  items: PlanItem[];
};

const ARCHIVE_KEY = "only-us-date-archive";
const ARCHIVE_EVENT = "only-us-date-archive-change";

const DEMO_DATES: DateMemory[] = [
  {
    id: "date-seongsu-2026",
    title: "성수에서 오래 걷던 날",
    date: "2026-06-07",
    notes: "커피를 마시고 서울숲까지 천천히 걸었던 오후",
    items: [
      { id: "date-seongsu-1", placeId: "seongsu-cafe", placeName: "대림창고", category: "카페", startTime: "13:00", durationMinutes: 80, expectedCost: 18000, order: 0, memo: "햇살이 좋았던 큰 창가", dayIndex: 0, coordinates: [127.0565, 37.5413] },
      { id: "date-seongsu-2", placeId: "seoul-forest", placeName: "서울숲", category: "산책", startTime: "15:00", durationMinutes: 100, expectedCost: 0, order: 1, memo: "나무 그늘 아래 오래 걸었어요.", dayIndex: 0, coordinates: [127.0374, 37.5444] },
    ],
  },
  {
    id: "date-seochon-2025",
    title: "서촌의 작은 골목",
    date: "2025-11-22",
    notes: "전시를 보고 골목 안 작은 식당에서 저녁을 먹었어요.",
    items: [
      { id: "date-seochon-1", placeId: "museum", placeName: "대림미술관", category: "전시", startTime: "14:00", durationMinutes: 90, expectedCost: 24000, order: 0, memo: "서로 고른 작품이 달라 더 재미있었어요.", dayIndex: 0, coordinates: [126.9735, 37.5775] },
      { id: "date-seochon-2", placeId: "seochon-walk", placeName: "서촌 골목", category: "산책", startTime: "16:00", durationMinutes: 70, expectedCost: 0, order: 1, memo: "해 질 무렵의 조용한 골목", dayIndex: 0, coordinates: [126.9696, 37.579] },
      { id: "date-seochon-3", placeId: "seochon-dinner", placeName: "안주마을", category: "저녁", startTime: "18:00", durationMinutes: 100, expectedCost: 52000, order: 2, memo: "오래 이야기했던 저녁", dayIndex: 0, coordinates: [126.971, 37.5767] },
    ],
  },
];

export function getArchivedDates(): DateMemory[] {
  if (typeof window === "undefined") return DEMO_DATES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ARCHIVE_KEY) || "[]") as DateMemory[];
    const saved = Array.isArray(parsed) ? parsed : [];
    return [...saved, ...DEMO_DATES.filter(demo => !saved.some(item => item.id === demo.id))];
  } catch {
    return DEMO_DATES;
  }
}

export function archiveDate(input: Omit<DateMemory, "id">) {
  if (typeof window === "undefined") return;
  const saved = getArchivedDates().filter(item => !item.id.startsWith("date-seongsu-") && !item.id.startsWith("date-seochon-"));
  const next: DateMemory = { ...input, id: `date-${Date.now()}` };
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify([next, ...saved]));
  window.dispatchEvent(new Event(ARCHIVE_EVENT));
}

export function subscribeDateArchive(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(ARCHIVE_EVENT, listener);
  return () => window.removeEventListener(ARCHIVE_EVENT, listener);
}
