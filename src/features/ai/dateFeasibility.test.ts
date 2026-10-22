import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { selectedDateFeasibility } from "./dateFeasibility";
import type { DiscoverCandidate } from "@/features/places/types/place";

const venues = Array.from({ length: 15 }, (_, index) => ({ externalSource: "kakao",
  externalPlaceId: String(index), expectedCostTwo: null }) as unknown as DiscoverCandidate);
const ids = venues.map(venue => `kakao:${venue.externalPlaceId}`);

describe("chosen itinerary feasibility lower bounds", () => {
  it("rejects selecting the same exact branch from two different providers", () => {
    const branch: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "a", name: "같은 식당",
      category: "restaurant", categoryLabel: "식당", district: "성수", address: "서울 성동구 성수이로 10",
      roadAddress: "", phone: "", mapUrl: "", coordinates: [127.05, 37.54] };
    expect(selectedDateFeasibility([branch, { ...branch, externalSource: "tourapi", externalPlaceId: "b" }],
      ["kakao:a", "tourapi:b"], emptyDateBrief())).toMatchObject({ reason: "duplicate_selected_place" });
  });
  it("keeps all fifteen selections feasible across three days", () => {
    expect(selectedDateFeasibility(venues, ids, { ...emptyDateBrief(), stayKind: "overnight", nights: 2 })).toBeNull();
  });
  it("explains an impossible one-hour selection without guessing travel times", () => {
    expect(selectedDateFeasibility(venues.slice(0, 3), ids.slice(0, 3), {
      ...emptyDateBrief(), startTime: "15:00", endTime: "16:00",
    })).toMatchObject({ reason: "selected_stays_exceed_time", minimumStayMinutes: 90, availableMinutes: 60 });
  });
  it("does not rule out a tight but possible visit based on unknown hours/costs", () => {
    expect(selectedDateFeasibility(venues.slice(0, 2), ids.slice(0, 2), {
      ...emptyDateBrief(), startTime: "15:00", endTime: "16:00", budgetWon: 0,
    })).toBeNull();
  });
  it("rejects missing signed anchors but ignores legacy budgets", () => {
    expect(selectedDateFeasibility(venues, ["kakao:missing"], emptyDateBrief())?.reason).toBe("missing_selected_places");
    expect(selectedDateFeasibility([{ ...venues[0], expectedCostTwo: 10000 }], ids.slice(0, 1), {
      ...emptyDateBrief(), budgetWon: 0,
    })).toBeNull();
  });
  it("uses arrival and departure windows rather than an entire day for each", () => {
    expect(selectedDateFeasibility(venues, ids, { ...emptyDateBrief(), stayKind: "overnight", nights: 1,
      startTime: "12:00", endTime: "20:00", userRequests: ["첫날 오후 7시 도착", "마지막 날 오후 2시 출발"],
    })).toMatchObject({ reason: "selected_stays_exceed_time", availableMinutes: 180 });
  });
  it.each([null, "미정", "2026-02-30"])("asks for an actual visit date before accepting a confirmed performance (%s)", dateLabel => {
    const performance = { ...venues[0], name: "연극 공연장", category: "photo", categoryLabel: "공연장",
      performanceEvent: { id: "PF1", title: "연극", dateYmd: "20261011", showtimes: ["18:00"],
        durationMinutes: 90, genre: "연극", sourceUrl: "https://kopis.or.kr/event", checkedAt: "2026-10-11" } } as DiscoverCandidate;
    expect(selectedDateFeasibility([performance], ids.slice(0, 1), { ...emptyDateBrief(), dateLabel }))
      .toMatchObject({ reason: "performance_visit_date_missing", message: expect.stringContaining("방문 날짜") });
  });
  it.each([[20, "18:20", null], [240, "19:00", "selected_stays_exceed_time"]] as const)(
    "uses a published %s-minute performance rather than a thirty-minute placeholder", (durationMinutes, endTime, reason) => {
      const hall = { ...venues[0], name: "공연장", category: "photo", categoryLabel: "공연장",
        detailedCategory: "문화,예술 > 공연장", performanceEvent: { id: "PF1", title: "공연",
          dateYmd: "20261011", showtimes: ["18:00"], durationMinutes, genre: "연극",
          sourceUrl: "https://kopis.or.kr/event", checkedAt: "2026-10-11" } } as DiscoverCandidate;
      expect(selectedDateFeasibility([hall], ids.slice(0, 1), {
        ...emptyDateBrief(), dateLabel: "2026-10-11", startTime: "18:00", endTime,
      })?.reason ?? null).toBe(reason);
    });
});
