import type { PlanItem, PlanKind } from "./types/plan";
import type { Place } from "@/features/places/types/place";

const STORAGE_KEYS: Record<PlanKind, string> = {
  trip: "only-us-draft-trip",
  date: "only-us-draft-date",
};
const TRIP_DAY_KEY = "only-us-trip-day";
const DEMO_TRIP_SEED_KEY = "only-us-demo-gunsan-trip-v1";
const META_KEYS: Record<PlanKind, string> = {
  trip: "only-us-draft-trip-meta",
  date: "only-us-draft-date-meta",
};
export const DEMO_GUNSAN_TRIP_ITEMS: PlanItem[] = [
  { id: "gunsan-d1-1", placeId: "gunsan-history", placeName: "군산근대역사박물관", category: "박물관", startTime: "10:00", durationMinutes: 80, expectedCost: 0, order: 0, memo: "군산의 근대사와 항구 이야기를 먼저 살펴봐요.", dayIndex: 0, coordinates: [126.7118, 35.9897] },
  { id: "gunsan-d1-2", placeId: "gunsan-chowon", placeName: "초원사진관", category: "영화 산책", startTime: "11:30", durationMinutes: 40, expectedCost: 0, order: 1, memo: "시간여행마을 골목과 영화의 장면을 천천히 걸어요.", dayIndex: 0, coordinates: [126.7085, 35.9877] },
  { id: "gunsan-d1-3", placeId: "gunsan-hirotzu", placeName: "신흥동 일본식가옥", category: "근대 건축", startTime: "14:00", durationMinutes: 60, expectedCost: 0, order: 2, memo: "점심 뒤 고요한 정원과 오래된 건축을 둘러봐요.", dayIndex: 0, coordinates: [126.7053, 35.9818] },
  { id: "gunsan-d1-4", placeId: "gunsan-dongguksa", placeName: "동국사", category: "사찰", startTime: "15:30", durationMinutes: 50, expectedCost: 0, order: 3, memo: "도심 속 사찰에서 여행의 속도를 잠시 낮춰요.", dayIndex: 0, coordinates: [126.7048, 35.9794] },
  { id: "gunsan-d2-1", placeId: "gunsan-railroad", placeName: "경암동 철길마을", category: "골목 산책", startTime: "09:30", durationMinutes: 70, expectedCost: 0, order: 4, memo: "철길을 따라 아침 산책과 사진을 남겨요.", dayIndex: 1, coordinates: [126.7206, 35.9818] },
  { id: "gunsan-d2-2", placeId: "gunsan-eunpa", placeName: "은파호수공원", category: "호수 산책", startTime: "11:20", durationMinutes: 80, expectedCost: 0, order: 5, memo: "물가를 따라 걸으며 느긋한 오전을 보내요.", dayIndex: 1, coordinates: [126.6894, 35.9564] },
  { id: "gunsan-d2-3", placeId: "gunsan-seonyudo", placeName: "선유도해수욕장", category: "바다", startTime: "14:30", durationMinutes: 100, expectedCost: 0, order: 6, memo: "고군산군도의 바다와 모래사장을 함께 걸어요.", dayIndex: 1, coordinates: [126.4118, 35.8166] },
  { id: "gunsan-d2-4", placeId: "gunsan-jangjado", placeName: "장자도 전망대", category: "노을", startTime: "17:00", durationMinutes: 70, expectedCost: 0, order: 7, memo: "섬과 바다가 겹치는 노을로 여행을 마무리해요.", dayIndex: 1, coordinates: [126.3889, 35.8121] },
];
export type DraftPlanMeta = { title: string; notes: string; startDate: string; dayCount: number };
type Listener = () => void;
const listeners = new Set<Listener>();

function read(kind: PlanKind): PlanItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[kind]);
    if (!raw) return kind === "trip" ? DEMO_GUNSAN_TRIP_ITEMS : [];
    const parsed = JSON.parse(raw) as PlanItem[];
    return Array.isArray(parsed)
      ? parsed.map(item => ({ ...item, dayIndex: Number.isFinite(item.dayIndex) ? item.dayIndex : 0 }))
      : [];
  } catch {
    return [];
  }
}

function write(kind: PlanKind, items: PlanItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(items));
  listeners.forEach(listener => listener());
}

export function getDraftPlanMeta(kind: PlanKind): DraftPlanMeta {
  const fallback = {
    title: kind === "date" ? "우리가 고른 데이트" : "군산에서 머문 이틀",
    notes: kind === "trip" ? "근대 골목에서 시작해 섬의 노을로 끝나는 1박 2일" : "",
    startDate: kind === "trip" ? "2026-10-14" : "",
    dayCount: kind === "trip" ? 2 : 1,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(META_KEYS[kind]);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DraftPlanMeta>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : fallback.title,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : "",
      dayCount: Number.isFinite(parsed.dayCount) ? Math.max(1, Math.min(7, Number(parsed.dayCount))) : 1,
    };
  } catch {
    return fallback;
  }
}

export function setDraftPlanMeta(kind: PlanKind, patch: Partial<DraftPlanMeta>) {
  if (typeof window === "undefined") return;
  const next = { ...getDraftPlanMeta(kind), ...patch };
  window.localStorage.setItem(META_KEYS[kind], JSON.stringify(next));
  listeners.forEach(listener => listener());
}

export function ensureDemoGunsanTrip() {
  if (typeof window === "undefined" || window.localStorage.getItem(DEMO_TRIP_SEED_KEY) === "ready") return;
  window.localStorage.setItem(STORAGE_KEYS.trip, JSON.stringify(DEMO_GUNSAN_TRIP_ITEMS));
  window.localStorage.setItem(META_KEYS.trip, JSON.stringify({
    title: "군산에서 머문 이틀",
    notes: "근대 골목에서 시작해 섬의 노을로 끝나는 1박 2일",
    startDate: "2026-10-14",
    dayCount: 2,
  } satisfies DraftPlanMeta));
  window.localStorage.setItem(TRIP_DAY_KEY, "0");
  window.localStorage.setItem(DEMO_TRIP_SEED_KEY, "ready");
  listeners.forEach(listener => listener());
}

function nextStart(items: PlanItem[]) {
  const last = items.at(-1);
  if (!last) return "13:00";
  const [hours, minutes] = last.startTime.split(":").map(Number);
  const total = (hours || 0) * 60 + (minutes || 0) + (last.durationMinutes || 60) + 20;
  const hour = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const minute = String(total % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function getDraftTripItems() {
  return read("trip");
}

export function getDraftDateItems() {
  return read("date");
}

export function subscribeDraftTrip(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setDraftTripItems(items: PlanItem[]) {
  write("trip", items.map((item, order) => ({ ...item, order, dayIndex: item.dayIndex ?? 0 })));
}

export function setDraftDateItems(items: PlanItem[]) {
  write("date", items.map((item, order) => ({ ...item, order, dayIndex: 0 })));
}

export function getActiveTripDay() {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(TRIP_DAY_KEY) ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.min(6, value) : 0;
}

export function setActiveTripDay(day: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TRIP_DAY_KEY, String(Math.max(0, Math.min(6, day))));
}

export function addPlaceToDraftTrip(place: Place) {
  return addPlaceToDraft("trip", place, getActiveTripDay());
}

export function addPlaceToDraftDate(place: Place) {
  return addPlaceToDraft("date", place, 0);
}

function addPlaceToDraft(kind: PlanKind, place: Place, dayIndex: number) {
  const items = read(kind);
  const existing = items.find(item => item.placeId === place.id || item.placeName === place.name);
  if (existing) return { item: existing, duplicate: true as const };
  const sameDay = items.filter(item => (item.dayIndex ?? 0) === dayIndex);
  const item: PlanItem = {
    id: `draft-${kind}-${place.id}`,
    placeId: place.id,
    placeName: place.name,
    category: place.categoryLabel,
    startTime: nextStart(sameDay),
    durationMinutes: place.durationMinutes || 60,
    expectedCost: place.expectedCostTwo ?? 0,
    order: items.length,
    memo: place.recommendReason || place.description || "",
    dayIndex,
    coordinates: place.coordinates,
  };
  write(kind, [...items, item]);
  return { item, duplicate: false as const };
}
