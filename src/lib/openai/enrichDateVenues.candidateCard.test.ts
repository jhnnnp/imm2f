import { expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { enrichResearchNeedEvidence } from "./enrichDateVenues";
import { readVenueEvidence } from "./venueEvidenceStore";

vi.mock("./venueEvidenceStore", () => ({
  readVenueEvidence: vi.fn(),
  writeVenueEvidence: vi.fn(),
}));

it("reuses fresh checked venue facts for candidate cards without requesting new quality research", async () => {
  const venue: DiscoverCandidate = {
    externalSource: "kakao", externalPlaceId: "venue-1", name: "해안 산책로",
    category: "tourist", categoryLabel: "관광명소", district: "부산",
    address: "부산 해운대구", roadAddress: "부산 해운대구 해변로 1",
    phone: "", mapUrl: "", coordinates: [129.16, 35.16],
  };
  const fact = { id: "fact-1", venueId: "kakao:venue-1", text: "해변을 따라 산책할 수 있습니다.",
    url: "https://example.com/venue", checkedAt: new Date().toISOString(),
    attribute: "experience" as const, verification: "source_checked" as const };
  vi.mocked(readVenueEvidence).mockResolvedValue(new Map([["kakao:venue-1", [fact]]]));

  const result = await enrichResearchNeedEvidence([venue], emptyDateBrief(), []);

  expect(result[0].evidence).toContainEqual(fact);
  expect(readVenueEvidence).toHaveBeenCalledOnce();
});
