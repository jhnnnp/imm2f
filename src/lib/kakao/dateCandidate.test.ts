import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { isDateCourseCandidate, looksLikeNonVenue } from "./dateCandidate";

function candidate(overrides: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    externalSource: "kakao",
    externalPlaceId: "1",
    name: "성수 카페",
    category: "cafe",
    categoryLabel: "카페",
    district: "성수",
    address: "",
    roadAddress: "",
    phone: "",
    mapUrl: "",
    coordinates: [127.056, 37.544],
    kakaoCategoryGroupCode: "CE7",
    ...overrides,
  };
}

describe("dateCourseCandidate", () => {
  it("drops station-only names even when Kakao tags them as cafes", () => {
    const station = candidate({ name: "낙원역" });
    expect(looksLikeNonVenue(station)).toBe(true);
    expect(isDateCourseCandidate(station, [])).toBe(false);
  });

  it("admits a current TourAPI festival", () => {
    const festival = candidate({
      externalSource: "tourapi",
      name: "청계천 축제",
      category: "festival",
      categoryLabel: "축제",
      kakaoCategoryGroupCode: undefined,
      openingHours: "2026.09.18 – 2026.09.21",
    });
    expect(isDateCourseCandidate(festival, [])).toBe(true);
  });

  it("does not treat a longer name as the exact requested venue", () => {
    const other = candidate({ name: "소월아트홀 주차장", category: "tourist", categoryLabel: "주차장", kakaoCategoryGroupCode: undefined });
    expect(isDateCourseCandidate(other, ["소월아트홀"])).toBe(false);
  });
});
