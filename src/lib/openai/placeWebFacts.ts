import type { DiscoverCandidate } from "@/features/places/types/place";

export type PlaceWebFact = {
  id: string;
  rating?: number;
  ratingCount?: number;
  food?: string;
  sourceUrl?: string;
  note?: string;
};

function asNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function asText(value: unknown, max: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : "";
}

export function sanitizePlaceWebFact(raw: unknown, allowedIds: Set<string>): PlaceWebFact | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = asText(row.id, 80);
  if (!id || !allowedIds.has(id)) return null;
  let rating = asNumber(row.rating);
  if (rating != null) {
    if (rating > 5 && rating <= 10) rating = Math.round((rating / 2) * 10) / 10;
    if (rating < 0 || rating > 5) rating = null;
    else rating = Math.round(rating * 10) / 10;
  }
  const count = asNumber(row.ratingCount);
  const ratingCount = count != null && count >= 1 && count < 1_000_000 ? Math.round(count) : undefined;
  const foodRaw = asText(row.food, 40);
  const food = foodRaw && /^(전시|산책로|자연경관|공원|분위기|감성|데이트|야경|관광|식사|음식|메뉴|카페|커피|디저트)$/.test(foodRaw) ? "" : foodRaw;
  const sourceUrl = asText(row.sourceUrl, 300);
  const note = asText(row.note, 80);
  const fact: PlaceWebFact = { id };
  if (rating != null) fact.rating = rating;
  if (ratingCount) fact.ratingCount = ratingCount;
  if (food) fact.food = food;
  if (/^https?:\/\//i.test(sourceUrl) && !/^https?:\/\/(?:www\.)?map\.kakao\.com\/?$/i.test(sourceUrl)) fact.sourceUrl = sourceUrl;
  if (note && !/분위기|감성|데이트하기 좋/.test(note)) fact.note = note;
  if (fact.rating != null && !fact.sourceUrl) {
    delete fact.rating;
    delete fact.ratingCount;
  }
  if (fact.rating == null && !fact.food && !fact.sourceUrl && !fact.note) return null;
  return fact;
}

export function sanitizePlaceWebFacts(raw: unknown, allowedIds: Set<string>) {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { facts?: unknown }).facts)
    ? (raw as { facts: unknown[] }).facts
    : [];
  const facts: PlaceWebFact[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const fact = sanitizePlaceWebFact(row, allowedIds);
    if (!fact || seen.has(fact.id)) continue;
    seen.add(fact.id);
    facts.push(fact);
  }
  return facts;
}

export function publicPlaceFactLine(fact: Pick<PlaceWebFact, "rating" | "ratingCount" | "food">) {
  const bits: string[] = [];
  if (fact.rating != null) {
    bits.push(fact.ratingCount ? `${fact.rating}점 · 후기 ${fact.ratingCount}` : `${fact.rating}점`);
  }
  if (fact.food) bits.push(fact.food);
  return bits.join(" · ");
}

export function applyPlaceWebFacts(candidates: DiscoverCandidate[], facts: PlaceWebFact[]) {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  return candidates.map(candidate => {
    const id = `${candidate.externalSource === "tourapi" ? "tourapi" : "kakao"}:${candidate.externalPlaceId}`;
    const fact = byId.get(id);
    if (!fact) return candidate;
    const foodOk = candidate.category === "restaurant" || candidate.category === "cafe";
    return {
      ...candidate,
      rating: fact.rating ?? candidate.rating,
      ratingCount: fact.ratingCount ?? candidate.ratingCount,
      dishes: foodOk ? (fact.food || candidate.dishes) : candidate.dishes,
      factSourceUrl: fact.sourceUrl || candidate.factSourceUrl,
      factNote: fact.note || candidate.factNote,
    };
  });
}

export function sourceHost(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
