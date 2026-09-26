import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";

const venue = (id: string, name: string, changes: Partial<DiscoverCandidate> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name, category: "restaurant", categoryLabel: "식당",
  district: "송파구", address: "", roadAddress: "", phone: "", mapUrl: "https://map.example/" + id,
  coordinates: [127.1, 37.5], ...changes,
});

describe("date candidate pool", () => {
  it("deduplicates and filters known hard conflicts before course design", () => {
    const state = { ...emptyDateBrief(), dateLabel: "2026-09-26", budgetWon: 100000,
      excludedFoods: ["해산물"], excludedPlaces: ["가지마 식당"],
    };
    const candidates = [
      venue("1", "안전한 식당", { expectedCostTwo: 80000 }),
      venue("1", "안전한 식당"),
      venue("2", "해산물 식당"),
      venue("3", "고급 식당", { expectedCostTwo: 120000 }),
      venue("4", "가지마 식당"),
      venue("5", "공연장", { performanceEvent: { id: "p", title: "공연", dateYmd: "20260927",
        showtimes: ["18:00"], genre: "연극", sourceUrl: "https://official.example/p", checkedAt: "2026-09-25" } }),
    ];
    const pool = buildDateCandidatePool(candidates, state);
    expect(pool.records).toHaveLength(5);
    expect(pool.eligible.map(item => item.name)).toEqual(["안전한 식당"]);
    expect(pool.records.map(item => item.rejectedReasons)).toEqual([
      [], ["excluded_food"], ["over_budget"], ["excluded_place"], ["event_date_mismatch"],
    ]);
    expect(pool.records[4].evidence[0]).toEqual(expect.objectContaining({ attribute: "event", venueId: "kakao:5" }));
  });
  it("uses past feedback as a soft score while keeping the venue eligible", () => {
    const place = venue("1", "지난번 식당");
    const neutral = buildDateCandidatePool([place], emptyDateBrief());
    const disliked = buildDateCandidatePool([place], { ...emptyDateBrief(), memorySignals: [
      { placeName: place.name, reaction: "disliked", confidence: 0.8 },
    ] });
    expect(disliked.eligible).toHaveLength(1);
    expect(disliked.records[0].scores.context).toBeLessThan(neutral.records[0].scores.context);
  });
});
