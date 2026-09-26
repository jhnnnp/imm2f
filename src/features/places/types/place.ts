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
  memoAuthorId?: string;
  durationMinutes: number;
  expectedCostTwo: number | null;
  coordinates: [number, number] | null;
  image?: string;
  visualTone: "photo" | "blue" | "brown" | "green";
  userStatus: PlacePreferenceStatus;
  partnerStatus: PlacePreferenceStatus;
  userRated?: boolean;
  partnerRated?: boolean;
  userFit: number;
  partnerFit: number;
  externalSource?: PlaceExternalSource;
  externalPlaceId?: string;
  recommendReason?: string;
  detailedCategory?: string;
  kakaoCategoryGroupCode?: string;
  searchRegion?: string;
  distanceMeters?: number;
  homepage?: string;
  detailFacts?: Array<{ label: string; value: string }>;
  tourDetailLoaded?: boolean;
};

export type VenueObservation = {
  id: string;
  text: string;
  url: string;
  checkedAt: string;
  /** The exact provider place to which the observation was attributed. */
  venueId?: string;
  branchName?: string;
  attribute?: "space" | "menu" | "experience";
  /** Search-reported excerpt; not independently retrieved or verified. */
  sourceExcerpt?: string;
  sourceVenueName?: string;
  sourceAddress?: string;
  /** A search citation is a lead, not independent verification of the claim. */
  verification?: "search_report" | "source_checked";
};

export type DiscoverCandidate = {
  /** Known two-person cost only; null/undefined means unverified. */
  expectedCostTwo?: number | null;
  evidence?: VenueObservation[];
  /** A cited search lead that still requires exact provider identity and fact verification. */
  discoveryLeadUrl?: string;
  /** KOPIS performance and venue are separate identities. */
  performanceEvent?: {
    id: string;
    title: string;
    dateYmd: string;
    showtimes: string[];
    genre: string;
    sourceUrl: string;
    checkedAt: string;
  };
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
  detailedCategory?: string;
  kakaoCategoryGroupCode?: string;
  searchRegion?: string;
  distanceMeters?: number;
  openingHours?: string;
  rating?: number;
  ratingCount?: number;
  dishes?: string;
  factSourceUrl?: string;
  factNote?: string;
};

export type KakaoPlaceCandidate = DiscoverCandidate;
