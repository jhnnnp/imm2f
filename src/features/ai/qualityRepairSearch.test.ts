import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import type { DateQualityAssessment, DateQualityRequirement } from "./dateQualityCritic";
import { qualityRepairSearches } from "./qualityRepairSearch";

function requirement(patch: Partial<DateQualityRequirement> = {}): DateQualityRequirement {
  return { id: "quality:cafe:quiet", dimension: "quiet", category: "cafe", origin: "explicit_constraint",
    status: "unknown", candidateIds: [], supportingCandidateIds: [], contradictedCandidateIds: [],
    alternativeCandidateIds: [], evidenceIds: [], sourceUrls: [], message: "카페의 조용함은 미확인", ...patch };
}
function assessment(requirements: DateQualityRequirement[]): DateQualityAssessment {
  return { requirements, needsRepair: requirements.some(item => item.origin === "explicit_constraint" && item.status !== "supported"),
    repairIssues: [], researchNeeds: [], warnings: [] };
}
const state = () => ({ ...emptyDateBrief(), activities: ["meal", "cafe"] as ["meal", "cafe"] });
const search = (requirements: DateQualityRequirement[], attempted: string[] = [], regions = ["성수"], limit?: number) =>
  qualityRepairSearches(assessment(requirements), state(), regions, new Set(attempted), limit);

describe("targeted quality repair source searches", () => {
  it("searches an unsatisfied explicit request while leaving a supported request alone", () => {
    const result = search([requirement({ status: "supported" }),
      requirement({ id: "menu", dimension: "menu", category: "meal", value: "파스타" })]);
    expect(result).toEqual([{ tool: "search_places", region: "성수", query: "파스타", category: "restaurant" }]);
  });

  it.each(["unknown", "contradicted", "missing"] as const)("researches an explicit %s quality", status => {
    expect(search([requirement({ status })])).toEqual([
      { tool: "search_places", region: "성수", query: "조용한 카페", category: "cafe" },
    ]);
  });

  it("does not spend source calls on inferred preferences alone", () => {
    const source = assessment([requirement({ origin: "inferred_preference" })]);
    // A stale summary flag must not promote a soft wish into another search.
    source.needsRepair = true;
    expect(qualityRepairSearches(source, state(), ["성수"], new Set())).toEqual([]);
    expect(search([])).toEqual([]);
  });

  it("keeps restaurant noise research attached to restaurants", () => {
    expect(search([requirement({ category: "meal" })])).toEqual([
      { tool: "search_places", region: "성수", query: "조용한 레스토랑", category: "restaurant" },
    ]);
  });

  it("uses the cafe role for an unspecific quiet request when the course includes a cafe", () => {
    expect(search([requirement({ category: "any" })])[0]).toMatchObject({ query: "조용한 카페", category: "cafe" });
  });

  it("tries an unsearched dish alias before expanding to a specialist query", () => {
    const menu = requirement({ dimension: "menu", category: "meal", value: "초밥|스시" });
    expect(search([menu], ["성수:초밥"])[0]).toMatchObject({ query: "스시", category: "restaurant" });
    expect(search([menu], ["성수:초밥", "성수:스시"])[0]).toMatchObject({ query: "초밥 전문점" });
    expect(search([menu], ["성수:초밥", "성수:스시", "성수:초밥 전문점"])).toEqual([]);
  });

  it("does not repeat a failed phrase or a duplicate requirement's exact source call", () => {
    const result = search([requirement(), requirement({ id: "quiet-again" })], ["성수:조용한 카페"]);
    expect(result.map(call => call.query)).toEqual(["티룸", "북카페"]);
    expect(new Set(result.map(call => `${call.region}:${call.query}`)).size).toBe(result.length);
  });

  it("keeps search attempts scoped to their region", () => {
    const result = search([requirement()], ["성수:조용한 카페"], ["성수", "연남"]);
    expect(result.map(({ region, query }) => ({ region, query }))).toEqual([
      { region: "성수", query: "티룸" }, { region: "연남", query: "조용한 카페" },
    ]);
  });

  it("stays within two destinations and three source calls", () => {
    const result = search([requirement(), requirement({ dimension: "menu", category: "meal", value: "파스타" }),
      requirement({ dimension: "hanok" })], [], ["성수", "연남", "부산"]);
    expect(result).toHaveLength(3);
    expect(new Set(result.map(call => call.region))).toEqual(new Set(["성수", "연남"]));
    expect(result.map(call => call.query)).toEqual(["조용한 카페", "조용한 카페", "파스타"]);
  });

  it.each([0, -1, -Infinity, 0.5])("makes no requests when the call budget is %s", limit => {
    expect(search([requirement()], [], ["성수"], limit)).toEqual([]);
  });
  it("honors a smaller positive request budget", () => {
    expect(search([requirement(), requirement({ dimension: "hanok" })], [], ["성수", "연남"], 1)).toHaveLength(1);
  });

  it.each([NaN, Infinity, 100])("keeps an invalid or excessive call budget bounded: %s", limit => {
    const result = search([requirement(), requirement({ dimension: "menu", category: "meal", value: "파스타" }),
      requirement({ dimension: "hanok" })], [], ["성수", "연남"], limit);
    expect(result).toHaveLength(3);
  });

  it("uses distinct nonempty regions without mutating the caller's list or attempts", () => {
    const regions = [" 성수 ", "성수", "", "연남", "부산"];
    const attempted = new Set(["성수:조용한 카페"]);
    const result = qualityRepairSearches(assessment([requirement()]), state(), regions, attempted);
    expect(result.map(call => call.region)).toEqual(["성수", "연남"]);
    expect(regions).toEqual([" 성수 ", "성수", "", "연남", "부산"]);
    expect([...attempted]).toEqual(["성수:조용한 카페"]);
  });

  it("does not send empty menu aliases to the place provider", () => {
    const result = search([requirement({ dimension: "menu", category: "meal", value: " | 파스타 | " })]);
    expect(result[0]).toMatchObject({ query: "파스타", category: "restaurant" });
    expect(result.every(call => call.query.trim().length >= 2)).toBe(true);
  });
});
