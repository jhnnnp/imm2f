import type { PlaceCategoryId } from "../types/place";

export const PLACE_CATEGORIES: ReadonlyArray<{
  id: PlaceCategoryId;
  label: string;
}> = [
  { id: "restaurant", label: "맛집" },
  { id: "cafe", label: "카페" },
  { id: "tourist", label: "관광지" },
  { id: "nature", label: "자연" },
  { id: "festival", label: "축제" },
  { id: "stay", label: "숙박" },
  { id: "photo", label: "사진" },
  { id: "book", label: "책방" },
];

export const TOUR_API_CATEGORIES: ReadonlyArray<PlaceCategoryId> = ["tourist", "festival", "stay"];

export function usesTourApi(category: PlaceCategoryId | "all" | undefined) {
  return Boolean(category && category !== "all" && TOUR_API_CATEGORIES.includes(category));
}
