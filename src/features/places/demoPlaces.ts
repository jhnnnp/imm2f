import type { Place } from "./types/place";

const STORAGE_KEY = "only-us-demo-places";
const EVENT_NAME = "only-us-demo-places-change";

export function getDemoPlaces(): Place[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDemoPlace(place: Place) {
  if (typeof window === "undefined") return;
  const current = getDemoPlaces();
  const index = current.findIndex(item => item.id === place.id || (
    place.externalPlaceId && item.externalPlaceId === place.externalPlaceId
  ));
  const next = [...current];
  if (index >= 0) next[index] = { ...next[index], ...place };
  else next.push(place);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function updateDemoPlaceStatus(id: string, status: Place["userStatus"]) {
  if (typeof window === "undefined") return;
  const next = getDemoPlaces().map(place => place.id === id ? { ...place, userStatus: status } : place);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeDemoPlaces(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT_NAME, listener);
    window.removeEventListener("storage", listener);
  };
}
