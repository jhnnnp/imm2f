import type { PlaceCategoryId } from "../types/place";

export const PLACE_CATEGORIES: ReadonlyArray<{
  id: PlaceCategoryId;
  label: string;
  icon: string;
}> = [
  { id: "restaurant", label: "맛집", icon: "♨" },
  { id: "cafe", label: "카페", icon: "◌" },
  { id: "nature", label: "자연", icon: "⌁" },
  { id: "photo", label: "사진", icon: "□" },
  { id: "book", label: "책방", icon: "▤" },
];
