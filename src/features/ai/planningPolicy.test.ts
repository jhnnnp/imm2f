import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { blocksCourse, legacyPlanningIssue, partitionPlanningIssues, planningIssue, PLANNING_POLICIES } from "./planningPolicy";
import { evaluateCourse, evaluatePreparedCourse, hardCourseProblems } from "./courseDesign";
import { emptyDateBrief } from "./dateBrief";
import { rewriteLegacyModelRows, validateModelRows } from "./dateCourse";

function candidate(id: string, category: DiscoverCandidate["category"], longitude: number): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: id, category, categoryLabel: category,
    district: "성수", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [longitude, 37.56] };
}
const venues = [candidate("meal", "restaurant", 127.04), candidate("cafe", "cafe", 127.041), candidate("walk", "nature", 127.042)];

describe("structured planning policy", () => {
  it("maps legacy display strings to the current policy at the compatibility boundary", () => {
    for (const [code, policy] of Object.entries(PLANNING_POLICIES)) {
      const issue = legacyPlanningIssue(policy.legacyFragment);
      expect(issue.code).toBe(code);
      expect(issue.severity).toBe(policy.severity);
      expect(hardCourseProblems([policy.legacyFragment]).length).toBe(policy.severity === "hard" ? 1 : 0);
    }
    expect(legacyPlanningIssue("새로운 미분류 메시지").code).toBe("legacy_unclassified");
  });

  it("uses codes, not display wording, to determine structured severity", () => {
    expect(blocksCourse([planningIssue("budget_exceeded", "문구가 변경됨")], "deterministic_seed")).toBe(true);
    expect(blocksCourse([planningIssue("low_variety", "확인된 비용이 예산 초과")], "deterministic_seed")).toBe(false);
    expect(planningIssue("required_activity_missing", "전시 누락", { constraint: "exhibit" },
      "hard", "explicit_constraint")).toMatchObject({ severity: "hard", origin: "explicit_constraint" });
  });

  it("accepts soft warnings in model and seed paths", () => {
    const soft = [planningIssue("low_variety", "1일차 경험이 한 종류로 반복", { dayIndex: 0 })];
    expect(blocksCourse(soft, "model_proposal")).toBe(false);
    expect(blocksCourse(soft, "deterministic_seed")).toBe(false);
    expect(blocksCourse([], "model_proposal")).toBe(false);
    expect(partitionPlanningIssues(soft)).toEqual({ hardViolations: [], softWarnings: soft });
  });

  it("treats legacy density and experience evidence as soft", () => {
    for (const code of ["stop_count", "sparse_day", "missing_daily_experience", "missing_daily_meal",
      "missing_experience_evidence", "repeated_cafe", "repeated_meal", "generic_chain"] as const) {
      expect(planningIssue(code, "")).toMatchObject({ severity: "soft", origin: "legacy_heuristic" });
    }
  });

  it("retains explicit safety authority separately from heuristic origins", () => {
    for (const code of ["budget_exceeded", "excluded_place", "excluded_food", "allergy_unverified", "required_place_missing"] as const)
      expect(planningIssue(code, "")).toMatchObject({ severity: "hard", origin: "explicit_constraint" });
  });

  it("reports typed day and constraint scope without losing legacy messages", () => {
    const result = evaluateCourse({ theme: "", rows: [] }, venues,
      { ...emptyDateBrief(), nights: 2, stayKind: "overnight", requiredPlaces: ["부산역"] }, new Set());
    expect(result.issues).toContainEqual(planningIssue("missing_day", "3일차 누락", { dayIndex: 2 }));
    expect(result.issues).toContainEqual(planningIssue("required_place_missing", "유지할 장소 누락: 부산역", { constraint: "부산역" }));
    expect([...new Set(result.issues.map(issue => issue.message))]).toEqual(result.problems);
  });

  it("records invalid candidate identity even though legacy preparation drops it", () => {
    const result = evaluateCourse({ theme: "", rows: [{ id: "invented" }] }, venues, emptyDateBrief(), new Set());
    expect(result.issues).toContainEqual(planningIssue("unknown_candidate", "검색으로 확인되지 않은 장소", { candidateId: "invented" }));
    expect(result.transformations.map(change => change.stage)).toContain("evaluation_candidate_filter");
    expect(result.rows).toEqual([]);
  });

  it("evaluates prepared rows without reordering, filling, or adding duration defaults", () => {
    const rows = [{ id: "kakao:cafe", day_index: 0 }, { id: "kakao:meal", day_index: 0 }];
    rows.forEach(Object.freeze);
    Object.freeze(rows);
    const proposal = { theme: "", rows };
    const result = evaluatePreparedCourse(proposal, rows, venues, emptyDateBrief(), new Set());
    expect(result.rows).toEqual(rows);
    expect(result.rows.every(row => row.duration_minutes === undefined)).toBe(true);
    expect(result.transformations).toEqual([]);
    expect(evaluateCourse(proposal, venues, emptyDateBrief(), new Set()).transformations
      .map(change => change.stage)).toContain("evaluation_duration_defaults");
  });

  it("exposes legacy fill and scheduling transformations while preserving the wrapper", () => {
    const rows = [{ id: "kakao:meal", day_index: 0 }];
    const state = { ...emptyDateBrief(), activities: ["meal", "cafe"] as Array<"meal" | "cafe"> };
    const result = rewriteLegacyModelRows(rows, venues, state);
    expect(result.rows).toEqual(validateModelRows(rows, venues, state));
    expect(result.rows.length).toBeGreaterThan(rows.length);
    expect(result.transformations.map(change => change.stage)).toContain("legacy_minimum_fill");
    expect(result.transformations.map(change => change.stage)).toContain("legacy_order_and_schedule");
    expect(rows).toEqual([{ id: "kakao:meal", day_index: 0 }]);
  });
});
