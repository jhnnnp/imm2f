import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { routeLegsFitSchedule, verifyDateItinerary } from "./dateVerifier";
import type { CourseEvaluation } from "./courseDesign";
import type { FootRoute } from "@/lib/routing/footRoute";

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
});
