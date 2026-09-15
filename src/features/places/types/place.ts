export type PlacePreferenceStatus =
  | "visited"
  | "want"
  | "must_visit"
  | "revisit"
  | "neutral"
  | "dislike"
  | "not_interested";

export type PlaceCategoryId = "restaurant" | "cafe" | "nature" | "photo" | "book";

export type Place = {
  id: string;
  name: string;
  category: PlaceCategoryId;
  categoryLabel: string;
  district: string;
  description: string;
  durationMinutes: number;
  expectedCostTwo: number;
  coordinates: [number, number];
  image?: string;
  visualTone: "photo" | "blue" | "brown" | "green";
  userStatus: PlacePreferenceStatus;
  partnerStatus: PlacePreferenceStatus;
  userFit: number;
  partnerFit: number;
};
