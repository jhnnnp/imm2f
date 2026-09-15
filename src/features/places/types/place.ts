export type PlacePreferenceStatus =
  | "visited"
  | "want"
  | "must_visit"
  | "revisit"
  | "neutral"
  | "dislike"
  | "not_interested";

export type PlaceCategoryId = "restaurant" | "cafe" | "nature" | "photo" | "book" | "tourist" | "festival" | "stay";
export type PlaceExternalSource = "kakao" | "manual" | "tourapi";

export type Place = {
  id: string;
  name: string;
  category: PlaceCategoryId;
  categoryLabel: string;
  district: string;
  address?: string;
  roadAddress?: string;
  mapUrl?: string;
  phone?: string;
  openingHours?: string | null;
  description: string;
  durationMinutes: number;
  expectedCostTwo: number | null;
  coordinates: [number, number];
  image?: string;
  visualTone: "photo" | "blue" | "brown" | "green";
  userStatus: PlacePreferenceStatus;
  partnerStatus: PlacePreferenceStatus;
  userFit: number;
  partnerFit: number;
  externalSource?: PlaceExternalSource;
  externalPlaceId?: string;
  recommendReason?: string;
};

export type DiscoverCandidate = {
  externalSource: "kakao" | "tourapi";
  externalPlaceId: string;
  name: string;
  category: PlaceCategoryId;
  categoryLabel: string;
  district: string;
  address: string;
  roadAddress: string;
  phone: string;
  mapUrl: string;
  coordinates: [number, number];
  image?: string;
};

export type KakaoPlaceCandidate = DiscoverCandidate;
