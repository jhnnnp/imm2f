import { expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { leadMatchesCandidate, sanitizeVenueLeads } from "./discoverVenueLeads";

it("accepts only cited exact names in the requested area", () => {
  const leads = sanitizeVenueLeads({ venues: [
    { name: "봉순이네다락방", region: "왕십리", role: "cafe", sourceUrl: "https://example.com/story?utm_source=test" },
    { name: "없는카페", region: "왕십리", role: "cafe", sourceUrl: "https://example.com/uncited" },
    { name: "다른동네", region: "성수", role: "cafe", sourceUrl: "https://example.com/story" },
  ] }, ["https://example.com/story"], ["왕십리"]);
  expect(leads).toEqual([{ name: "봉순이네다락방", region: "왕십리", role: "cafe", sourceUrl: "https://example.com/story?utm_source=test" }]);
});

it("does not let a similarly named cafe satisfy a performance venue lead", () => {
  const cafe: DiscoverCandidate = {
    externalSource: "kakao", externalPlaceId: "cafe", name: "할리스 소월아트홀점", category: "cafe",
    categoryLabel: "카페", detailedCategory: "카페 > 커피전문점", district: "성동구",
    address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56],
  };
  expect(leadMatchesCandidate({ name: "소월아트홀", region: "왕십리", role: "spot", sourceUrl: "https://example.com" }, cafe)).toBe(false);
  expect(leadMatchesCandidate({ name: cafe.name, region: "왕십리", role: "cafe", sourceUrl: "https://example.com" }, cafe)).toBe(true);
  expect(leadMatchesCandidate({ name: "할리스", region: "왕십리", role: "cafe", sourceUrl: "https://example.com" }, cafe)).toBe(false);
});
