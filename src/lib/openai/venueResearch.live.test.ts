import { loadEnvConfig } from "@next/env";
import { expect, it } from "vitest";
import { searchKakaoKeyword } from "@/lib/kakao/local";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import { enrichDateVenues } from "./enrichDateVenues";
import { recommendDatePlanWithOpenAi } from "./recommendDatePlan";
import { requestedActivityOrder } from "./designDateDiscovery";
import type { AIPlannerState } from "@/features/planning/types/plan";
import { attachKopisPerformances } from "@/lib/kopis/client";
import { readFileSync } from "node:fs";

// Explicit opt-in: this test uses paid search and current provider place records.
const live = process.env.LIVE_VENUE_RESEARCH === "1";
if (live) loadEnvConfig(process.cwd());
it.skipIf(!live)("researches exact provider branches with usable source metadata", async () => {
  const response = await searchKakaoKeyword("왕십리 카페");
  expect(response.ok).toBe(true);
  if (!response.ok) return;
  const candidates = response.places.filter(place => place.category === "cafe").slice(0, 4);
  expect(candidates.length).toBeGreaterThan(0);
  const started = Date.now();
  const researched = await enrichDateVenues(candidates, { ...emptyDateBrief(), userRequests: ["왕십리에서 예쁜 카페"] },
    { onRejected: detail => console.info("rejected_venue_observation", detail) });
  const supported = researched.filter(place => place.evidence?.length);
  console.info("venue_research_live", { candidates: candidates.length, supported: supported.length,
    elapsedMs: Date.now() - started, results: researched.map(place => ({ name: place.name,
      observations: place.evidence?.map(fact => ({ text: fact.text, url: fact.url, verification: fact.verification })) ?? [] })) });
  expect(supported.length, "No place-specific evidence; do not claim recommendation-quality improvement").toBeGreaterThan(0);
  for (const place of supported) for (const fact of place.evidence ?? []) {
    expect(fact.sourceExcerpt).toBeTruthy();
    expect(fact.sourceAddress).toBeTruthy();
    expect(fact.verification).toBe("search_report");
  }
}, 60000);

it.skipIf(!live)("preserves all requested roles in a real Wangsimni course", async () => {
  const searches = await Promise.all(["왕십리 식당", "왕십리 카페", "소월아트홀"].map(searchKakaoKeyword));
  const candidates = [...new Map(searches.flatMap(result => result.ok ? result.places : [])
    .map(place => [place.externalPlaceId, place])).values()];
  const state: AIPlannerState = { ...withAreas(emptyDateBrief(), ["왕십리"]), activities: ["meal", "cafe", "performance"],
    userRequests: ["왕십리에서 저녁 먹고 예쁜 카페와 공연장 데이트 코스"] };
  state.discovery = { themes: [], priorities: ["예쁜 카페"], queries: [], transport: "transit",
    requiredActivities: state.activities, activityOrder: requestedActivityOrder(state.userRequests[0], state.activities), minStops: 3, maxStops: 3 };
  const reply = await recommendDatePlanWithOpenAi({ prompt: state.userRequests[0], state, candidates, saved: [],
    condition: { dateLabel: "2026-09-24", startTime: "17:00", endTime: "21:00", budget: null, region: "왕십리", timeSpecified: false } });
  console.info("date_course_live", { source: reply.source, message: reply.message, design: reply.design,
    stops: reply.card.stops.map(stop => ({ name: stop.name, meta: stop.meta })) });
  expect(reply.items.length).toBeGreaterThanOrEqual(3);
  expect(reply.design?.rejectionReasons ?? []).not.toContain("같은 장소 중복");
  expect(reply.card.stops.some(stop => stop.name === "소월아트홀")).toBe(true);
  expect(reply.recommendations.map(place => place.activitySlot)).toEqual(["meal", "cafe", "performance"]);
  const cafe = reply.recommendations.find(place => place.activitySlot === "cafe");
  expect(cafe?.factSourceUrl, "An aesthetic cafe needs a sourced space observation").toBeTruthy();
  expect(cafe?.reasons[0]).toMatch(/공간|통창|테라스|정원|조명|인테리어|전망|뷰/);
  expect(reply.design?.routeBasis).toBe("walking");
  expect(reply.design?.totalDistanceMeters).toBeGreaterThan(0);
}, 120000);

it.skipIf(!live || process.env.LIVE_KOPIS_COURSE !== "1")("grounds the course in an actual dated performance", async () => {
  process.env.KOPIS_SERVICE_KEY ||= readFileSync(".env.local", "utf8").match(/^KOPIS_SERVICE_KEY=([^\r\n]+)/m)?.[1];
  const searches = await Promise.all(["왕십리 식당", "왕십리 카페", "소월아트홀"].map(searchKakaoKeyword));
  const found = [...new Map(searches.flatMap(result => result.ok ? result.places : [])
    .map(place => [place.externalPlaceId, place])).values()];
  const candidates = await attachKopisPerformances(found, "2026-10-09");
  expect(candidates.find(place => place.name === "소월아트홀")?.performanceEvent?.id).toBe("PF297542");
  const state: AIPlannerState = { ...withAreas(emptyDateBrief(), ["왕십리"]), dateLabel: "2026-10-09",
    startTime: "17:00", endTime: "22:00", activities: ["meal", "cafe", "performance"],
    userRequests: ["10월 9일 왕십리에서 저녁 먹고 예쁜 카페와 공연장 데이트 코스"] };
  state.discovery = { themes: [], priorities: ["예쁜 카페"], queries: [], transport: "transit",
    requiredActivities: state.activities, activityOrder: requestedActivityOrder(state.userRequests[0], state.activities), minStops: 3, maxStops: 3 };
  const started = performance.now();
  const reply = await recommendDatePlanWithOpenAi({ prompt: state.userRequests[0], state, candidates, saved: [],
    condition: { dateLabel: state.dateLabel!, startTime: "17:00", endTime: "22:00", budget: null, region: "왕십리", timeSpecified: true } });
  console.info("dated_course_live", { elapsedMs: Math.round(performance.now() - started), source: reply.source,
    stops: reply.card.stops.map(stop => ({ name: stop.name, startTime: stop.startTime, reason: stop.reason })), design: reply.design });
  expect(reply.recommendations.map(place => place.activitySlot)).toEqual(["meal", "cafe", "performance"]);
  expect(reply.card.stops[2].name).toBe("소월아트홀");
  expect(reply.card.stops[2].startTime).toBe("19:00");
  expect(reply.card.stops[2].reason).toContain("음그 콘서트");
}, 120000);
