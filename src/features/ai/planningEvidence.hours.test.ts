import { describe, expect, it } from "vitest";
import type { DiscoverCandidate, VenueObservation } from "@/features/places/types/place";
import { planningEvidenceProfile, verifiedOpeningAtVisit, verifiedOpeningWindows } from "./planningEvidence";

const now = Date.parse("2026-10-11T10:00:00+09:00");
const venue = (text: string, extra: Partial<VenueObservation> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: "a", name: "식당", category: "restaurant", categoryLabel: "음식점",
  address: "", roadAddress: "", district: "부산", phone: "", mapUrl: "", coordinates: [129, 35],
  evidence: [{ id: "hours", venueId: "kakao:a", attribute: "hours", verification: "source_checked",
    text, url: "https://example.com/hours", checkedAt: "2026-10-11T09:00:00+09:00", ...extra }],
});

describe("source-checked opening service periods", () => {
  it("keeps a restaurant break distinct and requires the entire stay to fit", () => {
    const place = venue("매일 11:00~21:00; 브레이크타임 15:00~17:00; 라스트오더 20:00");
    expect(verifiedOpeningWindows(place, "20261011", now)).toEqual([
      { startMinutes: 660, endMinutes: 900, latestEntryMinutes: 1200 },
      { startMinutes: 1020, endMinutes: 1260, latestEntryMinutes: 1200 },
    ]);
    expect(verifiedOpeningAtVisit(place, "20261011", "14:30", 60, now)).toBe("closed");
    expect(verifiedOpeningAtVisit(place, "20261011", "17:00", 80, now)).toBe("open");
    expect(verifiedOpeningAtVisit(place, "20261011", "20:01", 30, now)).toBe("closed");
    expect(planningEvidenceProfile(place, "16:00", "20261011", now).openingAtRequiredTime).toBe("confirmed_closed");
  });

  it("reads two service periods and end-of-day 24:00 without merging a closure", () => {
    const place = venue("매일 09:00~12:00, 18:00~24:00");
    expect(verifiedOpeningAtVisit(place, "20261011", "11:30", 60, now)).toBe("closed");
    expect(verifiedOpeningAtVisit(place, "20261011", "23:00", 60, now)).toBe("open");
  });

  it("resolves overnight opening and full-day operation", () => {
    const late = venue("매일 18:00~02:00");
    expect(verifiedOpeningAtVisit(late, "20261011", "00:30", 60, now)).toBe("open");
    expect(verifiedOpeningAtVisit(late, "20261011", "01:30", 60, now)).toBe("closed");
    expect(verifiedOpeningAtVisit(venue("연중무휴 24시간 운영"), "20261011", "18:00", 60, now)).toBe("open");
  });

  it("selects weekday and weekend hours independently", () => {
    const place = venue("월~금 09:00~18:00; 토~일 11:00~20:00");
    expect(verifiedOpeningAtVisit(place, "20261011", "10:00", 60, now)).toBe("closed");
    expect(verifiedOpeningAtVisit(place, "20261012", "10:00", 60, now)).toBe("open");
  });

  it("applies a weekly closure only on its named weekday", () => {
    const place = venue("매일 10:00~20:00; 월요일 휴무");
    expect(verifiedOpeningWindows(place, "20261012", now)).toEqual([]);
    expect(verifiedOpeningAtVisit(place, "20261011", "12:00", 60, now)).toBe("open");
    expect(verifiedOpeningAtVisit(venue("매일 10:00~20:00, 휴무일 없음"), "20261012", "12:00", 60, now)).toBe("open");
  });

  it("keeps daily hours when a closure comes first or uses a weekly label", () => {
    const place = venue("매주 월요일 정기 휴무, 매일 10:00~20:00");
    expect(verifiedOpeningAtVisit(place, "20261011", "12:00", 60, now)).toBe("open");
    expect(verifiedOpeningWindows(place, "20261012", now)).toEqual([]);
    const other = venue("매일 10:00~20:00, 월요일은 휴무");
    expect(verifiedOpeningAtVisit(other, "20261011", "12:00", 60, now)).toBe("open");
    expect(verifiedOpeningWindows(other, "20261012", now)).toEqual([]);
  });

  it("prioritizes a dated closure over generic daily hours", () => {
    const place = venue("매일 10:00~20:00");
    place.evidence!.push({ ...place.evidence![0], id: "specific", text: "2026.10.11 임시 휴무",
      checkedAt: "2026-10-11T08:00:00+09:00" });
    expect(verifiedOpeningWindows(place, "20261011", now)).toEqual([]);
    expect(verifiedOpeningAtVisit(place, "20261012", "12:00", 60, now)).toBe("open");
  });

  it.each([
    { venueId: "kakao:other" }, { verification: "search_report" as const }, { url: "" },
    { checkedAt: "2026-10-01" }, { checkedAt: "2026-10-12" },
  ])("leaves unmatched or stale observations unknown: %j", extra => {
    expect(verifiedOpeningWindows(venue("매일 10:00~20:00", extra), "20261011", now)).toBeNull();
  });

  it("does not match a date by concatenating numeric clock fragments", () => {
    expect(verifiedOpeningWindows(venue("운영 20:26, 10:11"), "20261011", now)).toBeNull();
    expect(verifiedOpeningWindows(venue("매일 10:00~20:00"), "20261220", now)).toBeNull();
    expect(verifiedOpeningWindows(venue("매일 10:00~20:00"), "20260230", now)).toBeNull();
  });
});
