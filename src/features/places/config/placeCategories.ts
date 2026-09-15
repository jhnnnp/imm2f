import type { PlaceCategoryId } from "../types/place";

export const PLACE_CATEGORIES: ReadonlyArray<{
  id: PlaceCategoryId;
  label: string;
  icon: string;
}> = [
  { id: "restaurant", label: "맛집", icon: "♨" },
  { id: "cafe", label: "카페", icon: "◌" },
  { id: "tourist", label: "관광지", icon: "△" },
  { id: "nature", label: "자연", icon: "⌁" },
  { id: "festival", label: "축제", icon: "◇" },
  { id: "stay", label: "숙박", icon: "▢" },
  { id: "photo", label: "사진", icon: "□" },
  { id: "book", label: "책방", icon: "▤" },
];

export const TOUR_API_CATEGORIES: ReadonlyArray<PlaceCategoryId> = ["tourist", "festival", "stay"];

export function usesTourApi(category: PlaceCategoryId | "all" | undefined) {
  return Boolean(category && category !== "all" && TOUR_API_CATEGORIES.includes(category));
}
