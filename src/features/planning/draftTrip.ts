import type { PlanItem, PlanKind } from "./types/plan";
import type { Place } from "@/features/places/types/place";

const STORAGE_KEYS: Record<PlanKind, string> = {
  trip: "only-us-draft-trip",
  date: "only-us-draft-date",
};
const TRIP_DAY_KEY = "only-us-trip-day";
const META_KEYS: Record<PlanKind, string> = {
  trip: "only-us-draft-trip-meta",
  date: "only-us-draft-date-meta",
};
export type DraftPlanMeta = { title: string; notes: string; startDate: string; dayCount: number };
type Listener = () => void;
const listeners = new Set<Listener>();

function read(kind: PlanKind): PlanItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[kind]);
    if (!raw) return [];
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
    title: kind === "date" ? "우리가 고른 데이트" : "우리가 고른 여행",
    notes: "",
    startDate: "",
    dayCount: 1,
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
