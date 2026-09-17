import type { KakaoPlaceCandidate, PlaceCategoryId } from "../types/place";
import { PLACE_CATEGORIES } from "./placeCategories";

export const KAKAO_CATEGORY_GROUP: Record<PlaceCategoryId, string | null> = {
  restaurant: "FD6",
  cafe: "CE7",
  nature: "AT4",
  photo: "CT1",
  book: null,
  tourist: "AT4",
  festival: null,
  stay: "AD5",
};

export const KAKAO_CATEGORY_QUERY: Record<PlaceCategoryId, string> = {
  restaurant: "맛집",
  cafe: "카페",
  nature: "공원",
  photo: "사진",
  book: "서점",
  tourist: "관광지",
  festival: "축제",
  stay: "숙박",
};

/** Kakao Local group codes that map onto the place chips. Everything else is noise. */
export const KAKAO_DISCOVER_GROUP_CODES: ReadonlySet<string> = new Set(
  Object.values(KAKAO_CATEGORY_GROUP).filter((code): code is string => Boolean(code)),
);

const UNGROUPED_DISCOVER = /서점|책방|북카페|도서관|사진|포토|축제|페스티벌|숙박|호텔|펜션|게스트하우스|리조트/;

export function kakaoGroupCode(category: PlaceCategoryId | "all" | undefined) {
  if (!category || category === "all") return "";
  return KAKAO_CATEGORY_GROUP[category] ?? "";
}

export function kakaoCategoryQuery(category: PlaceCategoryId | "all" | undefined) {
  if (!category || category === "all") return "";
  return KAKAO_CATEGORY_QUERY[category] || PLACE_CATEGORIES.find(item => item.id === category)?.label || "";
}

export function discoverSearchCategories(input: {
  category?: PlaceCategoryId | "all";
  categories?: PlaceCategoryId[];
}): PlaceCategoryId[] {
  if (input.categories?.length) return [...new Set(input.categories)];
  if (input.category && input.category !== "all") return [input.category];
  return PLACE_CATEGORIES.map(item => item.id);
}

export function isAllowedKakaoDiscoverPlace(place: KakaoPlaceCandidate) {
  if (place.externalSource === "tourapi") return true;
  const code = place.kakaoCategoryGroupCode ?? "";
  if (KAKAO_DISCOVER_GROUP_CODES.has(code)) return true;
  if (code) return false;
  return UNGROUPED_DISCOVER.test(`${place.detailedCategory ?? ""} ${place.categoryLabel} ${place.name}`);
}
