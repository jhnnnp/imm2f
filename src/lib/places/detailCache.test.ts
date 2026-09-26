import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { officialTourEvidenceTargets } from "./detailCache";

function tourist(id: string, lng: number): DiscoverCandidate {
  return { externalSource: "tourapi", externalPlaceId: id, name: id, category: "tourist",
    categoryLabel: "관광지", district: "군산", address: "전북 군산시", roadAddress: "", phone: "", mapUrl: "",
    coordinates: [lng, 35.97] };
}

describe("official tourism research selection", () => {
  it("covers separate destination areas before similar nearby listings", () => {
    const candidates = [tourist("a", 126.700), tourist("b", 126.701), tourist("c", 126.800)];
    expect(officialTourEvidenceTargets(candidates, 2).map(candidate => candidate.externalPlaceId)).toEqual(["a", "c"]);
  });
});
