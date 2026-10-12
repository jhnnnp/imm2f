import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import { recommendPlacesWithOpenAi } from "./recommendPlaces";
import { recommendDatePlanWithOpenAi } from "./recommendDatePlan";
import * as openAiClient from "./client";

// The fixtures describe controlled test venues. The API call is real; no web
// lookup is needed to test selection, correction priority and source grounding.
if (process.env.LIVE_OPENAI === "1") {
  for (const path of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const match = line.trim().match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
        if (path.endsWith(".local") || !(match[1] in process.env)) process.env[match[1]] = value;
      }
    } catch { /* optional environment file */ }
  }
}
const live = process.env.LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);

function venue(id: string, category: DiscoverCandidate["category"], evidence: string): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: `검증 테스트 ${id}`, category,
    categoryLabel: category === "cafe" ? "카페" : category === "restaurant" ? "식당" : "공원",
    detailedCategory: category === "cafe" ? "음식점 > 카페" : category === "restaurant" ? "음식점 > 이탈리안" : "여행 > 공원",
    district: "성수", address: "서울 성동구 성수동", roadAddress: "", phone: "", mapUrl: "",
    coordinates: [127.04 + (id.length % 3) * 0.0002, 37.54],
    evidence: [{ id: `fact-${id}`, venueId: `kakao:${id}`, text: evidence,
      url: `https://example.com/test/${id}`, checkedAt: "2026-10-12", verification: "source_checked" }] };
}

describe("recommendation judgments with the configured model (live)", () => {
  it.skipIf(!live)("preserves both model reasons for numeric provider names and explicitly unknown crowd/seat attributes", async () => {
    const pool = ["빌라1990", "카페1964"].map((name, index) => ({
      ...venue(`provider-only-${index}`, "cafe", ""), name, evidence: [],
    }));
    const writer = vi.spyOn(openAiClient, "completeJson");
    try {
      const result = await recommendPlacesWithOpenAi({
        message: "성수에서 둘이 오래 대화할 카페 2곳만 추천해줘. 붐비는 곳은 피하고 싶어. 각각의 추천 이유에 혼잡도나 좌석이 확인되지 않았다면 아직 모른다고 밝혀줘.",
        ask: { kind: "cafe", area: "성수", query: "오래 대화" }, candidates: pool,
        savedNames: new Set(), bothWant: new Set(), alreadyShown: [], skipFactLookup: true,
        coupleTaste: { summary: "둘이 오래 대화하고 쉬고 싶어함", commonTastes: [], avoidFoods: [] },
      });
      const generated = await writer.mock.results.at(-1)?.value as { picks?: Array<{ id: string; why: string }> } | null;
      expect(result.source).toBe("openai");
      expect(result.shownPlaces).toHaveLength(2);
      for (const stop of result.card.stops ?? []) {
        const candidate = pool.find(place => place.name === stop.name)!;
        const why = generated?.picks?.find(pick => pick.id === `kakao:${candidate.externalPlaceId}`)?.why;
        expect(stop.reason).toBe(why);
        expect(stop.reason?.length).toBeGreaterThan(25);
        expect(stop.reason).toMatch(/확인|모르|알 수|정보|미확인/);
      }
    } finally { writer.mockRestore(); }
  }, 55000);

  it.skipIf(!live)("prioritizes the current quiet conversation request over stale lively taste and novelty", async () => {
    const quiet = venue("quiet", "cafe", "이 지점은 조용한 독립 좌석과 작은 정원을 갖추고 있습니다.");
    const loud = venue("loud", "cafe", "이 지점은 큰 음악과 DJ 공연이 있는 공간이며 붐비는 편입니다.");
    const result = await recommendPlacesWithOpenAi({
      message: "오늘은 분위기 바뀌었어. 시끄러운 곳은 빼고, 조용히 대화할 카페 딱 한 곳만 골라줘.",
      ask: { kind: "cafe", area: "성수", query: "조용히 대화" }, candidates: [loud, quiet],
      savedNames: new Set(), bothWant: new Set(), alreadyShown: [quiet.name], skipFactLookup: true,
      coupleTaste: { summary: "활기차고 음악이 큰 공간을 좋아함", commonTastes: ["DJ 공연"], avoidFoods: [] },
      conversation: [{ role: "user", text: "처음엔 음악이 큰 카페를 보고 있었어." }],
    });
    expect(result.source).toBe("openai");
    expect(result.shownPlaces).toEqual([quiet.name]);
    expect(result.card.lines[0]).not.toContain("카카오맵 후기도 함께");
    expect(result.card.stops?.[0].reason?.length).toBeGreaterThan(15);
    expect(result.card.stops?.[0].factSourceUrl).toBe(quiet.evidence![0].url);
    expect(result.card.stops?.[0].reason).not.toMatch(/예약|평점|보장/);
  }, 55000);

  it.skipIf(!live)("writes a contextual course intro and individual judgments for every selected provider entity", async () => {
    const pool = [venue("meal", "restaurant", "라구 파스타와 뇨키를 직접 만들어 제공합니다."),
      venue("quiet", "cafe", "조용한 독립 좌석과 작은 정원에서 머물 수 있습니다."),
      venue("park", "nature", "강변 산책로와 벤치가 있습니다.")];
    const state = { ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"],
      pace: "relaxed" as const, userRequests: ["세 곳을 모두 넣되 대화하고 쉴 여유가 있었으면 좋겠어"],
      discovery: { themes: [], priorities: ["대화와 휴식"], queries: [], transport: "transit" as const,
        requiredActivities: [], activityOrder: [], minStops: 1, maxStops: 4 } };
    const result = await recommendDatePlanWithOpenAi({ prompt: "세 곳을 모두 넣되 대화하고 쉴 여유가 있었으면 좋겠어",
      condition: { region: "성수", dateLabel: "2026-10-12", startTime: "13:00", endTime: "20:00", budget: null, timeSpecified: true },
      candidates: pool, saved: [], state, researchPlanActive: true, anchorCandidateIds: pool.map(place => `kakao:${place.externalPlaceId}`) });
    expect(result.source).toBe("openai");
    expect(result.recommendations).toHaveLength(3);
    expect(result.card.lines[0]).not.toMatch(/에서 식사 →|곳을 날짜별로 묶었어요/);
    for (const stop of result.recommendations) {
      expect(stop.reasons[0].length).toBeGreaterThan(15);
      expect(stop.reasons[0]).not.toContain("아직 확인하지 못했어요");
      expect(pool.some(place => `kakao:${place.externalPlaceId}` === stop.id)).toBe(true);
    }
  }, 60000);
});
