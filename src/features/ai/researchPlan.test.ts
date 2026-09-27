import { afterEach, describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { ExperienceBlock, ExperiencePlan, ExperienceQuality } from "./experiencePlan";
import { buildDateCandidatePool } from "./dateCandidatePool";
import { emptyDateBrief } from "./dateBrief";
import { buildResearchPlan, compareResearchSearches, evaluateResearchCoverage,
  executeResearchIntents, freshResearchCandidateEvidence, getResearchPlanMode, primarySearchIntents,
  providerCategoryForResearchIntent, researchCoverageFallbackReason, researchSearchAuthority,
  researchSearchIntents, tryBuildResearchPlan, validateResearchPlan } from "./researchPlan";

const quality = (dimension: ExperienceQuality["dimension"], category: ExperienceQuality["category"] = "cafe"):
  ExperienceQuality => ({ dimension, category, source: "explicit_user" });
const block = (primaryExperience: string, qualitativeNeeds: ExperienceQuality[] = [],
  supportingNeeds: ExperienceBlock["supportingNeeds"] = []): ExperienceBlock => ({
  purpose: "주된 방문 경험", primaryExperience, visitContext: "한 권역의 방문",
  supportingNeeds, qualitativeNeeds, repeatJustification: null,
});
const plan = (days: Array<{ focus: string; blocks: ExperienceBlock[] }>): ExperiencePlan => ({
  objective: "데이트", overallPace: "balanced", tripStrategy: {
    geographicApproach: "날짜별 권역", experienceProgression: "가벼운 마무리", avoidRepeatedVisitContexts: true,
  }, days: days.map((day, dayIndex) => ({ dayIndex, purpose: `day ${dayIndex}`,
    density: "light", geographicFocus: day.focus, experienceBlocks: day.blocks })),
  requiredElements: [], optionalElements: [],
  qualitativeNeeds: days.flatMap(day => day.blocks.flatMap(value => value.qualitativeNeeds)),
  uncertainties: [],
});
const venue = (id: string, category: DiscoverCandidate["category"], region: string,
  evidenceText = "", checkedAt = new Date().toISOString()): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name: `${category} ${id}`, category,
  categoryLabel: category, district: region, address: region, roadAddress: region,
  phone: "", mapUrl: "https://example.test/map", coordinates: [127, 37], searchRegion: region,
  evidence: evidenceText ? [{ id: `${id}:e1`, text: evidenceText,
    url: "https://example.test/evidence", checkedAt, attribute: "space" }] : [],
});
afterEach(() => { delete process.env.DATE_RESEARCH_PLAN_MODE; });

describe("P3 ResearchPlan golden scenarios", () => {
  it("A: aesthetic cafe searches cafe venues and requests space evidence without meal/walk search", async () => {
    const experience = plan([{ focus: "익선동", blocks: [block("예쁜 카페에서 대화", [quality("aesthetic")])] }]);
    const research = buildResearchPlan(experience);
    expect(validateResearchPlan(research)).toBe(true);
    expect(research.needs.map(need => need.kind)).toEqual(["venue", "evidence"]);
    expect(research.needs[0]).toMatchObject({ category: "cafe", qualities: ["aesthetic"],
      geographicFocus: "익선동" });
    expect(research.needs[1].evidenceNeeded).toEqual(expect.arrayContaining(["space", "interior", "architecture", "view"]));
    expect(researchSearchIntents(research, "익선동")).toEqual([expect.objectContaining({
      region: "익선동", category: "cafe", query: "카페" })]);
    const legacy = [{ region: "익선동", category: "restaurant" as const, query: "식당" },
      { region: "익선동", category: "nature" as const, query: "산책" }];
    const comparison = compareResearchSearches(research, "익선동", legacy, experience.qualitativeNeeds);
    expect(comparison.qualitativeNeedLostCount).toBe(0);
    expect(comparison.unnecessaryLegacySupportSearchCount).toBe(2);
    expect(primarySearchIntents(true, research, "익선동", legacy).map(item => item.category)).toEqual(["cafe"]);
    expect(primarySearchIntents(false, research, "익선동", legacy)).toEqual(legacy);
    const calls: string[] = [];
    await executeResearchIntents(primarySearchIntents(true, research, "익선동", legacy), 1,
      async (intent, page) => { calls.push(`${intent.region}:${intent.category}:${intent.query}:${page}`); return []; });
    expect(calls).toEqual(["익선동:cafe:카페:1"]);
  });

  it("B: cafe-only stays cafe-only", () => {
    const research = buildResearchPlan(plan([{ focus: "익선동", blocks: [block("카페에서 쉬기")] }]));
    expect(researchSearchIntents(research, "익선동").map(item => item.category)).toEqual(["cafe"]);
    expect(research.needs.some(need => need.supportingRole === "meal")).toBe(false);
  });

  it("one provider query covers every research need that shared it", () => {
    const research = buildResearchPlan(plan([{ focus: "중구", blocks: [block("관광 경험"), block("문화 경험")] }]));
    const intents = researchSearchIntents(research, "부산");
    expect(intents).toHaveLength(1);
    expect(intents[0].needIds).toEqual(["day-0-block-0-venue", "day-0-block-1-venue"]);
    const coverage = evaluateResearchCoverage(research, [venue("1", "tourist", "중구")],
      new Set(intents.flatMap(intent => intent.needIds)));
    expect(coverage.map(item => item.status)).toEqual(["sufficient", "sufficient"]);
    expect(research.needs.map(item => item.priority)).toEqual(["required", "important"]);
    const explicit = plan([{ focus: "중구", blocks: [block("관광 경험"), block("카페에서 쉬기")] }]);
    explicit.requiredElements = ["cafe"];
    expect(buildResearchPlan(explicit).needs.filter(item => item.kind === "venue")
      .map(item => item.priority)).toEqual(["required", "required"]);
    const incomplete = evaluateResearchCoverage(buildResearchPlan(explicit), [venue("1", "tourist", "중구")],
      new Set(buildResearchPlan(explicit).needs.map(item => item.id)));
    expect(researchCoverageFallbackReason(buildResearchPlan(explicit), incomplete)).toBe("required_need_no_candidates");
    const importantOnly = buildResearchPlan(plan([{ focus: "중구", blocks: [block("관광 경험"), block("카페에서 쉬기")] }]));
    expect(researchCoverageFallbackReason(importantOnly,
      evaluateResearchCoverage(importantOnly, [venue("1", "tourist", "중구")],
        new Set(importantOnly.needs.map(item => item.id))))).toBeNull();
  });

  it("C: quiet keeps noise/crowd evidence and never credits a menu as quiet", () => {
    const research = buildResearchPlan(plan([{ focus: "성수", blocks: [block("조용한 카페", [quality("quiet")])] }]));
    expect(research.needs[1].evidenceNeeded).toEqual(expect.arrayContaining(["noise", "crowd"]));
    const cafe = venue("1", "cafe", "성수", "시그니처 메뉴는 딸기 케이크입니다.");
    const searched = new Set(research.needs.map(need => need.id));
    expect(evaluateResearchCoverage(research, [cafe], searched)[1].status).toBe("insufficient");
    const grounded = venue("1", "cafe", "성수", "실내 소음이 적다는 현장 안내가 있습니다.");
    expect(evaluateResearchCoverage(research, [grounded], searched)[1].status).toBe("sufficient");
  });

  it("D: atmosphere dining preserves a distinct evidence need", () => {
    const research = buildResearchPlan(plan([{ focus: "성수", blocks: [block("분위기 좋은 식당", [quality("atmosphere", "meal")])] }]));
    expect(research.needs[0].category).toBe("restaurant");
    expect(research.needs[1]).toMatchObject({ kind: "evidence", qualities: ["atmosphere"] });
    expect(research.needs[1].evidenceNeeded).toEqual(expect.arrayContaining(["space", "interior", "ambience"]));
    const pasta = buildResearchPlan(plan([{ focus: "성수", blocks: [block("파스타 식사")] }]));
    expect(researchSearchIntents(pasta, "성수")[0].query).toBe("파스타 식당");
  });

  it("E/F: trip blocks keep day geography; supporting meals remain relations", () => {
    const research = buildResearchPlan(plan([
      { focus: "동부산/기장", blocks: [block("문화 쇼핑", [], ["meal"]) ] },
      { focus: "해운대", blocks: [block("해변 산책", [], ["cafe"]) ] },
    ]));
    expect(research.needs.filter(need => need.kind === "venue")).toHaveLength(2);
    expect(research.needs.filter(need => need.kind === "relation")).toEqual([
      expect.objectContaining({ supportingRole: "meal", geographicFocus: "동부산/기장", experienceBlockId: "day-0-block-0" }),
      expect.objectContaining({ supportingRole: "cafe", geographicFocus: "해운대", experienceBlockId: "day-1-block-0" }),
    ]);
    expect(research.needs.some(need => need.kind === "venue" && need.category === "restaurant")).toBe(false);
    expect(researchSearchIntents(research, "부산")).toEqual(expect.arrayContaining([
      expect.objectContaining({ region: "기장", query: "쇼핑" }),
      expect.objectContaining({ region: "해운대", query: "명소" }),
    ]));
    expect(providerCategoryForResearchIntent({ category: "tourist", query: "쇼핑" })).toBeUndefined();
    expect(providerCategoryForResearchIntent({ category: "tourist", query: "관광지" })).toBe("tourist");
  });

  it("G: absent or invalid plan falls back; off/shadow never execute research search", () => {
    expect(researchSearchAuthority("active", null).fallbackReason).toBe("missing_experience_plan");
    expect(tryBuildResearchPlan({ ...plan([]), days: [] })).toBeNull();
    const valid = buildResearchPlan(plan([{ focus: "익선동", blocks: [block("카페에서 쉬기")] }]));
    expect(researchSearchAuthority("off", valid).active).toBe(false);
    expect(researchSearchAuthority("shadow", valid).active).toBe(false);
    expect(researchSearchAuthority("active", valid).active).toBe(true);
    expect(validateResearchPlan({ ...valid, needs: [{ ...valid.needs[0], geographicFocus: "어느 카페" }] })).toBe(false);
    expect(validateResearchPlan({ ...valid, needs: [{ ...valid.needs[0], purpose: "venue:invented" }] })).toBe(false);
    expect(validateResearchPlan({ ...valid, needs: [null] })).toBe(false);
    process.env.DATE_RESEARCH_PLAN_MODE = "active";
    expect(getResearchPlanMode()).toBe("active");
  });

  it("H: missing optional quality evidence does not trigger legacy fallback", () => {
    const research = buildResearchPlan(plan([{ focus: "익선동", blocks: [block("예쁜 카페", [quality("aesthetic")])] }]));
    const cafe = venue("1", "cafe", "익선동");
    const eligible = buildDateCandidatePool([cafe], emptyDateBrief()).eligible;
    const coverage = evaluateResearchCoverage(research, eligible, new Set(research.needs.map(need => need.id)));
    expect(coverage.map(row => row.status)).toEqual(["sufficient", "insufficient"]);
    expect(researchCoverageFallbackReason(research, coverage)).toBeNull();
    expect(researchCoverageFallbackReason(research,
      evaluateResearchCoverage(research, [], new Set(research.needs.map(need => need.id)))))
      .toBe("required_need_no_candidates");
  });

  it("never credits stale quality evidence", () => {
    const research = buildResearchPlan(plan([{ focus: "성수", blocks: [block("조용한 카페", [quality("quiet")])] }]));
    const stale = venue("1", "cafe", "성수", "실내 소음이 적습니다.", "2020-01-01T00:00:00Z");
    const coverage = evaluateResearchCoverage(research, [stale], new Set(research.needs.map(need => need.id)));
    expect(coverage[1].status).toBe("insufficient");
    expect(freshResearchCandidateEvidence(stale).evidence).toEqual([]);
    const staleHours = venue("2", "cafe", "성수", "10시부터 22시까지 영업합니다.", "2026-09-25T00:00:00Z");
    staleHours.evidence![0].attribute = "hours";
    expect(freshResearchCandidateEvidence(staleHours).evidence).toEqual([]);
  });
});
