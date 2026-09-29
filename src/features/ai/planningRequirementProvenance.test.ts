import { describe, expect, it } from "vitest";
import { emptyDateBrief, withActivities, withAreas, withCuisine } from "./dateBrief";
import { evaluateCourse } from "./courseDesign";
import { dateCandidateKey, rewriteLegacyModelRows, validateModelRows } from "./dateCourse";
import { resolveCuisineRequirement, resolveRequiredActivities } from "./planningRequirementProvenance";
import { PLANNING_SCENARIOS } from "./planningPolicy.scenarios";

const fixture = PLANNING_SCENARIOS.find(item => item.id === "A_busan_three_days")!;
const candidates = [fixture.candidates[1], fixture.candidates[2], fixture.candidates[3]];
const rows = [{ id: dateCandidateKey(candidates[0]), day_index: 0 },
  { id: dateCandidateKey(candidates[1]), day_index: 0 }];
const base = () => withAreas(emptyDateBrief(), ["성수"]);
const evaluate = (state: ReturnType<typeof base>, customCandidates = candidates) =>
  evaluateCourse({ theme: "", rows }, customCandidates, state, new Set());

describe("planning requirement provenance", () => {
  it("makes an explicitly requested exhibition hard", () => {
    const state = { ...base(), activities: ["exhibit" as const],
      discovery: { themes: [], priorities: [], queries: [], transport: "walk" as const,
        requiredActivities: ["exhibit" as const], activityOrder: [], minStops: 2, maxStops: 4 },
      userRequests: ["전시 꼭 넣어줘"] };
    expect(resolveRequiredActivities(state)).toContainEqual({ activity: "exhibit",
      origin: "explicit_constraint", explicit: true });
    expect(evaluate(state).hardIssues).toContainEqual(expect.objectContaining({
      code: "required_activity_missing", origin: "explicit_constraint" }));
  });

  it("keeps a discovery/default or memory-derived activity soft", () => {
    const state = { ...base(), activities: ["exhibit" as const],
      discovery: { themes: [], priorities: [], queries: [], transport: "walk" as const,
        requiredActivities: ["exhibit" as const], activityOrder: [], minStops: 2, maxStops: 4 } };
    expect(resolveRequiredActivities(state)[0].origin).toBe("legacy_heuristic");
    expect(evaluate(state).softIssues).toContainEqual(expect.objectContaining({ code: "required_activity_missing" }));
    const remembered = { ...state, memorySuggestions: { activities: ["exhibit" as const], cuisine: null } };
    expect(resolveRequiredActivities(remembered)[0].origin).toBe("inferred_preference");
    expect(evaluate(remembered).hardIssues.some(issue => issue.code === "required_activity_missing")).toBe(false);
  });

  it("does not make a candidate browsing request a mandatory course activity", () => {
    const state = { ...base(), activities: ["cafe" as const],
      userRequests: ["카페 후보 보여줘"] };
    expect(resolveRequiredActivities(state)[0]).toMatchObject({
      activity: "cafe", explicit: false, origin: "legacy_heuristic" });
  });

  it("recognizes a direct intake activity choice without inventing a user turn", () => {
    const state = withActivities(base(), ["전시"]);
    expect(resolveRequiredActivities(state)[0]).toMatchObject({ activity: "exhibit",
      origin: "explicit_constraint", explicit: true });
  });

  it("does not let a separate disliked clause erase an explicit activity", () => {
    const state = { ...base(), activities: ["exhibit" as const],
      userRequests: ["전시 꼭 넣어줘, 카페는 싫어"] };
    expect(resolveRequiredActivities(state)[0].origin).toBe("explicit_constraint");
  });

  it("does not carry an older explicit activity as hard after a later rejection", () => {
    const state = { ...base(), activities: ["cafe" as const],
      userRequests: ["카페 가자", "카페는 싫어"] };
    expect(resolveRequiredActivities(state)[0]).toMatchObject({ activity: "cafe", explicit: false });
  });

  it("makes a user-requested pasta cuisine mismatch hard", () => {
    const state = { ...base(), cuisine: "양식" as const, userRequests: ["파스타 먹고 싶어"] };
    expect(resolveCuisineRequirement(state)).toMatchObject({ cuisine: "양식",
      origin: "explicit_constraint", explicit: true });
    expect(evaluate(state).hardIssues).toContainEqual(expect.objectContaining({ code: "cuisine_mismatch" }));
  });

  it("keeps a cuisine request explicit alongside an unrelated dislike", () => {
    const state = { ...base(), cuisine: "양식" as const,
      userRequests: ["파스타 먹고 싶어, 시끄러운 곳은 싫어"] };
    expect(resolveCuisineRequirement(state).origin).toBe("explicit_constraint");
  });

  it("keeps a default or inferred cuisine mismatch soft, but an intake choice hard", () => {
    const state = { ...base(), cuisine: "양식" as const };
    expect(resolveCuisineRequirement(state).origin).toBe("legacy_heuristic");
    expect(evaluate(state).softIssues).toContainEqual(expect.objectContaining({ code: "cuisine_mismatch" }));
    const remembered = { ...state, memorySuggestions: { activities: [], cuisine: "양식" as const } };
    expect(resolveCuisineRequirement(remembered).origin).toBe("inferred_preference");
    expect(evaluate(remembered).hardIssues.some(issue => issue.code === "cuisine_mismatch")).toBe(false);
    const selected = withCuisine(base(), "양식");
    expect(resolveCuisineRequirement(selected).origin).toBe("explicit_constraint");
    expect(evaluate(selected).hardIssues).toContainEqual(expect.objectContaining({ code: "cuisine_mismatch" }));
  });

  it("never softens an explicit excluded food", () => {
    const state = { ...base(), cuisine: "양식" as const, excludedFoods: ["해산물"] };
    const conflicting = [{ ...candidates[0], dishes: "해산물 파스타" }, ...candidates.slice(1)];
    expect(evaluate(state, conflicting).hardIssues).toContainEqual(expect.objectContaining({ code: "excluded_food" }));
  });

  it("records the policy reason of a legacy fill without changing its output", () => {
    const state = { ...base(), activities: ["meal" as const, "cafe" as const] };
    const input = [rows[0]];
    const rewritten = rewriteLegacyModelRows(input, candidates, state);
    expect(rewritten.rows).toEqual(validateModelRows(input, candidates, state));
    expect(rewritten.transformations).toContainEqual(expect.objectContaining({
      stage: "legacy_minimum_fill", reasonCode: "stop_count", origin: "legacy_heuristic" }));
    expect(rewritten.transformations.every(item => Boolean(item.reasonCode))).toBe(true);
  });

  it("records the explicit cuisine behind a legacy replacement", () => {
    const state = { ...withCuisine(base(), "양식"), activities: ["meal" as const] };
    const western = { ...candidates[0], externalPlaceId: "western", name: "양식 레스토랑" };
    const rewritten = rewriteLegacyModelRows([rows[0]], [...candidates, western], state);
    expect(rewritten.transformations).toContainEqual(expect.objectContaining({
      stage: "legacy_cuisine_replacement", reasonCode: "cuisine_mismatch",
      origin: "explicit_constraint" }));
    expect(rewritten.rows).toEqual(validateModelRows([rows[0]], [...candidates, western], state));
  });
});
