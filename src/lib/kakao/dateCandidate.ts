import type { KakaoPlaceCandidate } from "@/features/places/types/place";

const DATE_GROUP_CODES = new Set(["CE7", "FD6", "AT4", "CT1"]);

// Kakao does not assign a category group code to every useful date venue.
// Admit only narrow, auditable category paths instead of trusting all uncoded results.
const SAFE_UNGROUPED_CATEGORY = /(?:^|>)\s*(?:서점|책방|북카페|도서관|미술관|박물관|전시관|전시장|공연장|극장|영화관|수목원|식물원|동물원|아쿠아리움|테마파크|놀이공원|볼링장|방탈출카페|보드카페|보드게임카페|오락실|만화카페|노래방|VR카페)\s*(?:>|$)/;
const TRANSIT_GROUP_CODES = new Set(["SW8"]);

function normalizedName(value: string) {
  return value.replace(/\s+/g, "").replace(/\d+호선$/g, "");
}

function isExplicitTransit(candidate: KakaoPlaceCandidate, requiredPlaces: string[]) {
  if (!TRANSIT_GROUP_CODES.has(candidate.kakaoCategoryGroupCode ?? "")) return false;
  const candidateName = normalizedName(candidate.name);
  return requiredPlaces.some(place => {
    const requiredName = normalizedName(place);
    return requiredName.length >= 2 && (candidateName === requiredName || candidateName.startsWith(requiredName));
  });
}

function isExplicitParkAccess(candidate: KakaoPlaceCandidate, requiredPlaces: string[]) {
  if (candidate.kakaoCategoryGroupCode) return false;
  if (!/(?:^|>)\s*입출구\s*$/.test(candidate.detailedCategory ?? "")) return false;
  const candidateName = normalizedName(candidate.name);
  return requiredPlaces.some(place => place.endsWith("공원") && candidateName.includes(normalizedName(place)));
}

export function isDateCourseCandidate(candidate: KakaoPlaceCandidate, requiredPlaces: string[]) {
  const groupCode = candidate.kakaoCategoryGroupCode ?? "";
  if (DATE_GROUP_CODES.has(groupCode)) return true;
  if (isExplicitTransit(candidate, requiredPlaces)) return true;
  if (isExplicitParkAccess(candidate, requiredPlaces)) return true;
  if (groupCode) return false;
  return SAFE_UNGROUPED_CATEGORY.test(candidate.detailedCategory ?? "");
}
