import { loadEnvConfig } from "@next/env";
import { expect, it } from "vitest";
import { searchKakaoKeyword } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { hydrateDateCandidates } from "@/lib/places/detailCache";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import { recommendDatePlanWithOpenAi } from "./recommendDatePlan";
import { buildFallbackCourse, discoveryCatalog, evaluateCourse, hardCourseProblems } from "@/features/ai/courseDesign";

const live = process.env.LIVE_TRIP_COURSE === "1";
if (live) loadEnvConfig(process.cwd());

it.skipIf(!live)("audits a real two-day Gunsan itinerary", async () => {
  const queries = ["군산 관광지", "군산 근대역사거리", "군산 맛집", "군산 카페", "군산 공원"];
  const results = await Promise.all(queries.map(searchKakaoKeyword));
  expect(results.every(result => result.ok)).toBe(true);
  const official = await searchTourPlacesRemote({ region: "군산", category: "tourist", x: 126.7, y: 35.97, radius: 16000 });
  const found = [...new Map([...results.flatMap(result => result.ok ? result.places : []),
    ...(official.ok ? official.places : [])]
    .map(place => [`${place.externalSource}:${place.externalPlaceId}`, place])).values()];
  const candidates = await hydrateDateCandidates(found, []);
  const state = { ...withAreas(emptyDateBrief(), ["군산"]), stayKind: "overnight" as const, nights: 1,
    userRequests: ["군산 1박2일 여행을 실제로 다니기 좋은 코스로 짜줘"],
    discovery: { themes: ["군산 근대거리와 지역 음식"], priorities: ["지역의 볼거리", "여유로운 동선"],
      queries: [], transport: "transit" as const, requiredActivities: [], activityOrder: [], minStops: 4, maxStops: 6 } };
  const catalog = discoveryCatalog(candidates, state, new Set(), 54);
  const fallback = buildFallbackCourse(catalog, state, new Set());
  console.info("trip_fallback_audit", { categoryCounts: catalog.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1; return counts;
  }, {}), stops: fallback.rows.map(row => ({ day: row.day_index, name: catalog.find(item => `${item.externalSource}:${item.externalPlaceId}` === row.id)?.name })),
  problems: evaluateCourse(fallback, catalog, state, new Set()).problems });
  const reply = await recommendDatePlanWithOpenAi({ prompt: state.userRequests[0], state, candidates, saved: [],
    condition: { dateLabel: "", startTime: "11:00", endTime: "21:00", budget: null, region: "군산", timeSpecified: false } });
  console.info("trip_course_live_audit", { candidateCount: candidates.length, message: reply.message,
    stops: reply.card.stops.map((stop, index) => ({ day: (stop.dayIndex ?? 0) + 1, name: stop.name,
      role: reply.recommendations[index]?.activitySlot, reason: stop.reason })), design: reply.design });
  if (!reply.items.length) {
    expect(reply.design?.rejectionReasons.some(reason => reason.includes("여행 핵심 장소 근거 부족"))).toBe(true);
  } else {
    expect(reply.items.length).toBeGreaterThanOrEqual(4);
    expect(new Set(reply.items.map(item => item.dayIndex))).toEqual(new Set([0, 1]));
    expect(reply.message).toContain("숙소");
    expect(reply.design?.evidenceCoverage.supportedStops).toBeGreaterThanOrEqual(2);
    expect(hardCourseProblems(evaluateCourse({ theme: "", rows: reply.recommendations.map((item, index) => ({
      id: item.id, day_index: reply.items[index]?.dayIndex ?? 0,
    })) }, candidates, state, new Set()).problems)).toEqual([]);
  }
}, 120000);
