import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { Database } from "@/lib/supabase/database.types";
import { storedVenueObservation } from "./venueEvidenceStore";

type Row = Database["public"]["Tables"]["venue_evidence"]["Row"];
const now = Date.parse("2026-09-24T12:00:00Z");
const candidate: DiscoverCandidate = {
  externalSource: "kakao", externalPlaceId: "123", name: "소월아트홀", category: "photo",
  categoryLabel: "공연장", district: "성동구", address: "서울 성동구 왕십리로 281",
  roadAddress: "서울 성동구 왕십리로 281", phone: "", mapUrl: "", coordinates: [127.04, 37.56],
};
const row: Row = {
  id: "fact-1", external_source: "kakao", external_place_id: "123", branch_name: "소월아트홀",
  venue_address: "서울 성동구 왕십리로 281", attribute: "experience", observation: "공연장입니다.",
  source_url: "https://example.com/hall", source_excerpt: "소월아트홀은 공연장입니다.",
  source_venue_name: "소월아트홀", source_address: "서울 성동구 왕십리로 281",
  verification: "search_report", checked_at: "2026-09-23T12:00:00Z", created_at: "2026-09-23T12:00:00Z",
};

describe("persisted venue evidence", () => {
  it("restores a recent observation for the same provider place and branch", () => {
    expect(storedVenueObservation(row, candidate, now)).toMatchObject({ venueId: "kakao:123", branchName: "소월아트홀" });
  });

  it("never attaches a nearby cafe's observation to a performance venue", () => {
    expect(storedVenueObservation({ ...row, branch_name: "할리스 소월아트홀점" }, candidate, now)).toBeNull();
    expect(storedVenueObservation({ ...row, venue_address: "서울 성동구 왕십리로 283" }, candidate, now)).toBeNull();
    expect(storedVenueObservation({ ...row, external_place_id: "456" }, candidate, now)).toBeNull();
  });

  it("expires a search report faster than an independently checked source", () => {
    const older = { ...row, checked_at: "2026-09-10T12:00:00Z" };
    expect(storedVenueObservation(older, candidate, now)).toBeNull();
    expect(storedVenueObservation({ ...older, verification: "source_checked" }, candidate, now)).not.toBeNull();
  });
});
