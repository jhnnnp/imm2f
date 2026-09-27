import { describe, expect, it } from "vitest";
import { buildFallbackCourse, evaluateCourse, planningStopGuidance } from "./courseDesign";
import { verifyDateItinerary } from "./dateVerifier";
import { blocksCourse } from "./planningPolicy";
import { planningEvidenceProfile, requiredOpeningTime } from "./planningEvidence";
import { planningFailureMessage } from "./planningFailureMessage";
import { PLANNING_SCENARIOS } from "./planningPolicy.scenarios";
import { isTravelPlan, withAreas } from "./dateBrief";

const condition = { dateLabel: "2026-10-06", startTime: "11:00", endTime: "21:00",
  budget: null, region: "부산", timeSpecified: false };

describe("P1-B planning acceptance", () => {
  it.each(PLANNING_SCENARIOS)("$id: $expected", scenario => {
    const evaluation = evaluateCourse({ theme: "fixture", rows: scenario.rows }, scenario.candidates,
      scenario.state, new Set());
    const accepted = scenario.expected === "accepted";
    expect(blocksCourse(evaluation.issues, "model_proposal")).toBe(!accepted);
    expect(blocksCourse(evaluation.issues, "deterministic_seed")).toBe(!accepted);
    const verification = verifyDateItinerary({ course: evaluation, candidates: scenario.candidates,
      state: scenario.state, condition, route: null });
    expect(verification.passed).toBe(accepted);
    expect(verification.hardIssues).toEqual(evaluation.hardIssues);
    expect(verification.softIssues).toEqual(evaluation.softIssues);
    expect(verification.warnings).toEqual([...new Set(evaluation.softIssues.map(issue => issue.message))]);
    expect(evaluation.qualitySignals.length).toBeGreaterThan(0);
  });

  it("removes the fixed eight-stop feasibility floor and reduces fallback fill", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "A_busan_three_days")!;
    expect(planningStopGuidance(scenario.state).min).toBe(3);
    const fallback = buildFallbackCourse(scenario.candidates, scenario.state, new Set());
    expect(fallback.rows.length).toBeLessThan(8);
    expect(fallback.rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fallback.rows.map(row => row.day_index))).toEqual(new Set([0, 1, 2]));
  });

  it("honors an explicit every-day meal requirement", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "D_restful_trip")!;
    const state = { ...scenario.state, userRequests: ["매일 저녁 맛집 꼭 넣어줘"] };
    const evaluation = evaluateCourse({ theme: "", rows: scenario.rows }, scenario.candidates, state, new Set());
    expect(evaluation.hardIssues.some(issue => issue.code === "missing_daily_meal")).toBe(true);
    expect(blocksCourse(evaluation.issues, "model_proposal")).toBe(true);
  });

  it("accepts an active local date with a repeated activity as a soft warning", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "G_active_date")!;
    const state = withAreas(scenario.state, ["성수"]);
    const candidates = scenario.candidates.map((candidate, index) => ({ ...candidate,
      district: "성동구", coordinates: [127.04 + index * 0.001, 37.56] as [number, number] }));
    expect(isTravelPlan(state)).toBe(false);
    const evaluation = evaluateCourse({ theme: "", rows: scenario.rows }, candidates, state, new Set());
    expect(evaluation.hardIssues).toEqual([]);
    expect(evaluation.softIssues.map(issue => issue.code)).toContain("low_variety");
    expect(verifyDateItinerary({ course: evaluation, candidates, state, condition,
      route: null }).passed).toBe(true);
  });

  it("honors an exact stop count only when explicitly requested", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "F_short_evening")!;
    const state = { ...scenario.state, userRequests: ["딱 2곳만 골라줘"] };
    const evaluation = evaluateCourse({ theme: "", rows: scenario.rows }, scenario.candidates, state, new Set());
    expect(evaluation.hardIssues.map(issue => issue.code)).toContain("explicit_stop_count");
    expect(evaluation.softIssues.map(issue => issue.code)).toContain("stop_count");
  });

  it("requires exact-branch recent hours evidence for an explicit late opening requirement", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "S_required_opening")!;
    const time = requiredOpeningTime(scenario.state);
    expect(time).toBe("22:00");
    expect(planningEvidenceProfile({ ...scenario.candidates[0], openingHours: "매일 09:00~23:00" },
      time, "20261006").openingAtRequiredTime).toBe("unknown");
    const checked = scenario.candidates.map(candidate => ({ ...candidate, evidence: [{
      id: `${candidate.externalPlaceId}-hours`, venueId: `kakao:${candidate.externalPlaceId}`,
      attribute: "hours" as const, text: "매일 09:00~23:00", url: "https://example.com/hours",
      checkedAt: new Date(Date.now() - 60_000).toISOString(), verification: "source_checked" as const,
    }] }));
    const evaluation = evaluateCourse({ theme: "", rows: scenario.rows }, checked, scenario.state, new Set());
    expect(evaluation.hardIssues.map(issue => issue.code)).not.toContain("required_opening_unverified");
    const stale = { ...checked[0], evidence: checked[0].evidence?.map(item => ({ ...item,
      checkedAt: new Date(Date.now() - 9 * 86_400_000).toISOString() })) };
    expect(planningEvidenceProfile(stale, time, "20261006").openingAtRequiredTime).toBe("unknown");
  });

  it("keeps an explicit core area and verified route limit blocking", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "G_active_date")!;
    const candidates = scenario.candidates.map((candidate, index) => index === 5
      ? { ...candidate, distanceMeters: 3000 } : candidate);
    const state = { ...withAreas(scenario.state, ["성수"]), areaScope: "core" as const };
    const course = evaluateCourse({ theme: "", rows: scenario.rows }, candidates, state, new Set());
    expect(course.hardIssues.map(issue => issue.code)).toContain("outside_area");
    const safe = evaluateCourse({ theme: "", rows: scenario.rows }, scenario.candidates,
      scenario.state, new Set());
    const route = { provider: "osm_foot" as const, meters: 3300, seconds: 2400,
      legs: [{ meters: 3300, seconds: 2400 }] };
    expect(verifyDateItinerary({ course: safe, candidates: scenario.candidates, state: scenario.state,
      condition, route }).hardIssues.map(issue => issue.code)).toContain("actual_route_limit");
  });

  it("names the actual trip length and does not request already supplied required places", () => {
    const scenario = PLANNING_SCENARIOS.find(item => item.id === "A_busan_three_days")!;
    expect(planningFailureMessage(scenario.state, []).includes("2박3일")).toBe(true);
    expect(planningFailureMessage({ ...scenario.state, requiredPlaces: ["해변"] }, [])).not.toContain("꼭 가고 싶은 곳");
    expect(planningFailureMessage(scenario.state, ["1일차 여행 핵심 장소 근거 부족"])).not.toContain("1박2일");
  });
});
