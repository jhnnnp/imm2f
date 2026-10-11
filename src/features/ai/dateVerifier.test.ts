import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { routeLegsFitSchedule, verifyDateItinerary } from "./dateVerifier";
import type { CourseEvaluation } from "./courseDesign";
import type { FootRoute } from "@/lib/routing/footRoute";
import type { DiscoverCandidate } from "@/features/places/types/place";

const course = { rows: [{ id: "kakao:a", day_index: 0, start_time: "17:00", duration_minutes: 60 },
  { id: "kakao:b", day_index: 0, start_time: "18:30", duration_minutes: 60 }],
  problems: [], score: 10, meters: 500, longestHop: 500, evidenceCount: 0, theme: "" } as CourseEvaluation;
const condition = { dateLabel: "2026-09-26", startTime: "17:00", endTime: "20:00",
  budget: null, region: "잠실", timeSpecified: false };
const route = (meters: number, seconds: number): FootRoute =>
  ({ provider: "osm_foot", meters, seconds, legs: [{ meters, seconds }] });

describe("date itinerary verifier", () => {
  it("checks walking time against the reserved gap", () => {
    expect(routeLegsFitSchedule(course.rows, [{ meters: 700, seconds: 1200 }])).toBe(true);
    expect(routeLegsFitSchedule(course.rows, [{ meters: 700, seconds: 1900 }])).toBe(false);
  });

  it("verifies the default day against an explicit zero day and rejects malformed legs", () => {
    const rows = [{ ...course.rows[0], day_index: undefined }, course.rows[1]];
    expect(routeLegsFitSchedule(rows, [{ meters: 500, seconds: 1900 }])).toBe(false);
    expect(routeLegsFitSchedule(rows, [{ meters: 500, seconds: NaN }])).toBe(false);
    expect(routeLegsFitSchedule(rows, [{ meters: 500, seconds: -1 }])).toBe(false);
  });

  it("rejects a real route beyond the walking limit even if the straight-line plan passed", () => {
    const verification = verifyDateItinerary({ course, candidates: [], state: emptyDateBrief(), condition,
      route: route(3300, 2400) });
    expect(verification.passed).toBe(false);
    expect(verification.issues).toContain("실제 보행 경로가 이동 한도를 초과함");
  });

  it("keeps provider unavailability distinct from a verified route", () => {
    const verification = verifyDateItinerary({ course, candidates: [], state: emptyDateBrief(), condition,
      route: null });
    expect(verification.passed).toBe(true);
    expect(verification.routeVerified).toBe(false);
  });

  it("checks hours after actual walking time even when the user hid clock labels", () => {
    const places: DiscoverCandidate[] = ["a", "b"].map(id => ({ externalSource: "kakao", externalPlaceId: id,
      name: id, category: "cafe", categoryLabel: "카페", district: "성수", address: "성수", roadAddress: "성수",
      phone: "", mapUrl: "", coordinates: [127.04, 37.56],
      ...(id === "b" ? { evidence: [{ id: "hours", venueId: "kakao:b", attribute: "hours", verification: "source_checked",
        text: "매일 09:00~19:00", url: "https://example.com/hours", checkedAt: new Date().toISOString() }] } : {}) }));
    const verification = verifyDateItinerary({ course, candidates: places,
      state: { ...emptyDateBrief(), dateLabel: "2026-10-11" }, condition,
      route: route(800, 4200) });
    expect(verification.passed).toBe(false);
    expect(verification.hardIssues.some(issue => issue.code === "actual_route_schedule_conflict")).toBe(true);
    expect(verification.scheduledRows).toEqual([]);
  });

  it.each([[10, true], [50, false]] as const)("verifies two fixed shows with a %s-minute real leg", (minutes, passed) => {
    const places: DiscoverCandidate[] = ["19:00", "21:00"].map((showtime, index) => ({ externalSource: "kakao",
      externalPlaceId: index ? "b" : "a", name: `공연 ${index}`, category: "photo", categoryLabel: "공연장",
      district: "성수", address: "성수", roadAddress: "성수", phone: "", mapUrl: "", coordinates: [127.04, 37.56],
      performanceEvent: { id: `show-${index}`, title: `공연 ${index}`, dateYmd: "20261011", showtimes: [showtime],
        genre: "클래식", sourceUrl: "https://kopis.or.kr/event", checkedAt: "2026-10-11" } }));
    const verification = verifyDateItinerary({ course: { ...course,
      rows: course.rows.map(row => ({ ...row, duration_minutes: 90 })) }, candidates: places,
      state: { ...emptyDateBrief(), dateLabel: "2026-10-11", startTime: "18:00", endTime: "23:00" },
      condition: { ...condition, dateLabel: "2026-10-11", startTime: "18:00", endTime: "23:00", timeSpecified: true },
      route: route(800, minutes * 60) });
    expect(verification.passed).toBe(passed);
    expect(verification.routeVerified).toBe(true);
    expect(verification.scheduledRows?.map(row => row.start_time)).toEqual(passed ? ["19:00", "21:00"] : []);
    expect(verification.hardIssues.some(issue => issue.code === "actual_route_schedule_conflict")).toBe(!passed);
  });

  it.each([null, route(800, 600)])("refuses an undated confirmed showing even when the route is %j", actualRoute => {
    const show: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "a", name: "공연장", category: "photo",
      categoryLabel: "공연장", district: "성수", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [127.04, 37.56],
      performanceEvent: { id: "show", title: "공연", dateYmd: "20261011", showtimes: ["19:00"], durationMinutes: 150,
        genre: "뮤지컬", sourceUrl: "https://example.com/show", checkedAt: "2026-10-11" } };
    const result = verifyDateItinerary({ course, candidates: [show], state: { ...emptyDateBrief(), dateLabel: null },
      condition, route: actualRoute });
    expect(result.passed).toBe(false);
    expect(result.hardIssues.some(issue => issue.code === "performance_time_unverified")).toBe(true);
  });

  it("rechecks published runtime and closing after actual walking, preserving only flexible compression", () => {
    const show: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "a", name: "공연장", category: "photo",
      categoryLabel: "공연장", district: "성수", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [127.04, 37.56],
      performanceEvent: { id: "show", title: "공연", dateYmd: "20261011", showtimes: ["19:00"], durationMinutes: 150,
        genre: "뮤지컬", sourceUrl: "https://example.com/show", checkedAt: "2026-10-11" } };
    const cafe: DiscoverCandidate = { ...show, externalPlaceId: "b", name: "카페", category: "cafe", categoryLabel: "카페",
      performanceEvent: undefined, evidence: [{ id: "hours", venueId: "kakao:b", attribute: "hours", verification: "source_checked",
        text: "매일 10:00~22:10", url: "https://example.com/hours", checkedAt: new Date().toISOString() }] };
    const input = { course: { ...course, rows: course.rows.map(row => ({ ...row, duration_minutes: 60 })) },
      candidates: [show, cafe], state: { ...emptyDateBrief(), dateLabel: "2026-10-11", startTime: "17:00", endTime: "23:00" },
      condition: { ...condition, dateLabel: "2026-10-11", startTime: "17:00", endTime: "23:00" } };
    const valid = verifyDateItinerary({ ...input, route: route(800, 600) });
    expect(valid.passed).toBe(true);
    expect(valid.scheduledRows?.map(row => [row.start_time, row.duration_minutes])).toEqual([["19:00", 150], ["21:40", 30]]);
    const invalid = verifyDateItinerary({ ...input, route: route(800, 3000) });
    expect(invalid.passed).toBe(false);
    expect(invalid.scheduledRows).toEqual([]);
  });

  it.each([
    ["1일차 여행일 핵심 경험 누락", true, "missing_daily_experience", "soft"],
    ["예산 초과", true, "legacy_unclassified", "soft"],
    ["새로운 미분류 경고", true, "legacy_unclassified", "soft"],
  ] as const)("applies legacy policy to %s", (message, passed, code, severity) => {
    const verification = verifyDateItinerary({ course: { ...course, problems: [message] },
      candidates: [], state: emptyDateBrief(), condition, route: null });
    expect(verification.passed).toBe(passed);
    expect((passed ? verification.softIssues : verification.hardIssues)[0]).toMatchObject({ code, severity });
    expect(verification.issues).toEqual(passed ? [] : [message]);
    expect(verification.warnings).toEqual(passed ? [message] : []);
  });
});
