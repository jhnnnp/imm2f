import { districtFromAddress, geocodeKakaoAddressRemote, searchKakaoPlacesRemote } from "@/lib/kakao/local";
import type { KakaoPlaceCandidate, Place } from "./types/place";

export type PlaceLocationPatch = { address: string; roadAddress: string; district: string; coordinates: [number, number] | null; mapUrl?: string };
export type PlaceLocationInput = { address: string; district?: string };

const PROVINCE_ALIASES = [
  ["서울특별시", "서울"], ["부산광역시", "부산"], ["대구광역시", "대구"], ["인천광역시", "인천"],
  ["광주광역시", "광주"], ["대전광역시", "대전"], ["울산광역시", "울산"], ["세종특별자치시", "세종시", "세종"],
  ["경기도", "경기"], ["강원특별자치도", "강원도", "강원"], ["충청북도", "충북"], ["충청남도", "충남"],
  ["전북특별자치도", "전라북도", "전북"], ["전라남도", "전남"], ["경상북도", "경북"], ["경상남도", "경남"],
  ["제주특별자치도", "제주도", "제주"],
] as const;

function compact(value: string) { return value.replace(/\s+/g, "").trim(); }

function provinceIndex(address: string) {
  const first = address.trim().split(/\s+/)[0] ?? "";
  return PROVINCE_ALIASES.findIndex(group => (group as readonly string[]).includes(first));
}

/** Expands old, short and current official province names into equivalent searches. */
export function koreanAddressVariants(address: string) {
  const normalized = address.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const [, ...rest] = normalized.split(" ");
  const index = provinceIndex(normalized);
  if (index < 0) return [normalized];
  const tail = rest.join(" ");
  return [...new Set(PROVINCE_ALIASES[index].map(alias => `${alias} ${tail}`.trim()).concat(normalized))];
}

export function geocodableAddressVariants(address: string) {
  const withoutUnit = address.trim().replace(/\s+(?:지하\s*)?\d+(?:층|호)(?:\s.*)?$/, "");
  return [...new Set([address.trim(), withoutUnit].flatMap(koreanAddressVariants))];
}

function addressParts(address: string) {
  const tokens = address.trim().split(/\s+/).filter(Boolean);
  return {
    province: provinceIndex(address),
    municipalities: tokens.filter(token => /(?:시|군|구)$/.test(token)),
    neighborhoods: tokens.filter(token => /(?:읍|면|동|리)$/.test(token)),
    roads: tokens.filter(token => /(?:대로|로|길)(?:\d+번길)?$/.test(token)),
    numbers: tokens.filter(token => /^\d+(?:-\d+)?$/.test(token)),
  };
}

function addressMatchScore(expected: string, candidate: string) {
  if (!expected.trim()) return 0;
  const wanted = addressParts(expected);
  const found = addressParts(candidate);
  if (wanted.province >= 0 && found.province >= 0 && wanted.province !== found.province) return null;
  let score = wanted.province >= 0 && wanted.province === found.province ? 30 : 0;
  for (const key of ["municipalities", "neighborhoods", "roads"] as const) {
    for (const token of wanted[key]) {
      if (!found[key].includes(token)) return null;
      score += key === "roads" ? 35 : 25;
    }
  }
  if (wanted.numbers.length && found.numbers.length) {
    if (!wanted.numbers.some(number => found.numbers.includes(number))) return null;
    score += 20;
  }
  return score;
}

export function pickKakaoLocationHit(places: KakaoPlaceCandidate[], name: string, address = "") {
  const needle = compact(name);
  const ranked = places.flatMap((place, index) => {
    const score = addressMatchScore(address, place.roadAddress || place.address);
    if (score === null) return [];
    const candidateName = compact(place.name);
    const nameScore = needle && (candidateName === needle || candidateName.includes(needle) || needle.includes(candidateName)) ? 15 : 0;
    return [{ place, score: score + nameScore - index / 100 }];
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.place ?? null;
}

export function locationQueries(name: string, address: string) {
  const trimmedName = name.trim();
  const variants = koreanAddressVariants(address);
  if (!variants.length) return trimmedName.length >= 2 ? [trimmedName] : [];
  return [...new Set(variants.flatMap(variant => [[trimmedName, variant].filter(Boolean).join(" "), variant]).filter(query => query.length >= 2))];
}

export async function resolvePlaceLocation(name: string, input: PlaceLocationInput): Promise<PlaceLocationPatch> {
  const address = input.address.trim();
  const district = input.district?.trim() ?? "";
  for (const variant of geocodableAddressVariants(address)) {
    const geocoded = await geocodeKakaoAddressRemote(variant);
    if (!geocoded) continue;
    return {
      address: geocoded.address,
      roadAddress: geocoded.roadAddress,
      district: geocoded.district || districtFromAddress(address) || district,
      coordinates: geocoded.coordinates,
    };
  }
  for (const query of locationQueries(name, address)) {
    const result = await searchKakaoPlacesRemote({ query });
    if (!result.ok || !result.places.length) continue;
    const hit = pickKakaoLocationHit(result.places, name, address);
    if (!hit) continue;
    return {
      address: hit.address || address, roadAddress: hit.roadAddress || "",
      district: hit.district || districtFromAddress(hit.roadAddress || hit.address || address) || district,
      coordinates: hit.coordinates, mapUrl: hit.mapUrl || undefined,
    };
  }
  return { address, roadAddress: "", district: districtFromAddress(address) || district, coordinates: null };
}

export function applyPlaceLocation(place: Place, patch: PlaceLocationPatch): Place {
  return {
    ...place, address: patch.address || place.address, roadAddress: patch.roadAddress,
    district: patch.district || place.district, coordinates: patch.coordinates,
    mapUrl: place.externalSource === "kakao" ? patch.mapUrl : place.mapUrl,
  };
}
