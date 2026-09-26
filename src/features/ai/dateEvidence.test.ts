import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { candidateEvidenceFacts, evidenceConfidence } from "./dateEvidence";

const venue: DiscoverCandidate = {
  externalSource: "kakao", externalPlaceId: "123", name: "정원 카페", category: "cafe",
  categoryLabel: "카페", district: "성동구", address: "", roadAddress: "", phone: "", mapUrl: "",
  coordinates: [127.04, 37.56],
};

describe("attribute evidence", () => {
  it("keeps provenance by attribute and ignores another branch", () => {
    const candidate: DiscoverCandidate = { ...venue, evidence: [
      { id: "reported", venueId: "kakao:123", text: "정원 좌석", attribute: "space", verification: "search_report", url: "https://example.com/a", checkedAt: "2026-09-25" },
      { id: "checked", venueId: "kakao:123", text: "정원 좌석", attribute: "space", verification: "source_checked", url: "https://example.com/b", checkedAt: "2026-09-25" },
      { id: "wrong", venueId: "kakao:999", text: "파스타", attribute: "menu", verification: "source_checked", url: "https://example.com/c", checkedAt: "2026-09-25" },
    ] };
    const facts = candidateEvidenceFacts(candidate, Date.parse("2026-09-26"));
    expect(facts.map(fact => fact.attribute)).toEqual(["space", "space"]);
    expect(facts[1].confidence).toBeGreaterThan(facts[0].confidence);
    expect(facts[1]).toEqual(expect.objectContaining({ venueId: "kakao:123", excerpt: "정원 좌석" }));
    expect(evidenceConfidence(candidate, "reservation")).toBe(0);
  });
});
