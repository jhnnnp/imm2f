import type { PlaceCategoryId } from "../types/place";
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

export function kakaoGroupCode(category: PlaceCategoryId | "all" | undefined) {
  if (!category || category === "all") return "";
  return KAKAO_CATEGORY_GROUP[category] ?? "";
}

export function kakaoCategoryQuery(category: PlaceCategoryId | "all" | undefined) {
  if (!category || category === "all") return "";
  return KAKAO_CATEGORY_QUERY[category] || PLACE_CATEGORIES.find(item => item.id === category)?.label || "";
}
