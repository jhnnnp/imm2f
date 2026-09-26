import { loadEnvConfig } from "@next/env";
import { expect, it } from "vitest";
import { searchKakaoKeyword } from "@/lib/kakao/local";
import { searchTourPlacesRemote } from "@/lib/tourapi/client";
import { hydrateDateCandidates } from "@/lib/places/detailCache";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import { buildFallbackCourse, discoveryCatalog, evaluateCourse, hardCourseProblems } from "@/features/ai/courseDesign";
import { candidateActivitySlot, dateCandidateKey, isOffDateVenue } from "@/features/ai/dateCourse";

const live = process.env.LIVE_TRIP_REGIONS === "1";
if (live) loadEnvConfig(process.cwd());

const cities = [
  { name: "군산", coordinates: [126.7, 35.97] },
  { name: "전주", coordinates: [127.15, 35.82] },
  { name: "경주", coordinates: [129.22, 35.84] },
] as const;

it.skipIf(!live).each(cities)("records a sourced two-day baseline in $name", async city => {
  const queries = [`${city.name} 관광지`, `${city.name} 맛집`, `${city.name} 카페`, `${city.name} 공원`];
  const results = await Promise.all(queries.map(searchKakaoKeyword));
  const official = await searchTourPlacesRemote({ region: city.name, category: "tourist",
    x: city.coordinates[0], y: city.coordinates[1], radius: 16000 });
  expect(results.some(result => result.ok)).toBe(true);
  const found = [...new Map([...results.flatMap(result => result.ok ? result.places : []),
    ...(official.ok ? official.places : [])]
    .map(candidate => [dateCandidateKey(candidate), candidate])).values()];
  const state = { ...withAreas(emptyDateBrief(), [city.name]), stayKind: "overnight" as const,
    nights: 1, userRequests: [`${city.name} 1박2일 여행 코스`],
    discovery: { themes: [], priorities: [], queries: [], transport: "transit" as const,
      requiredActivities: [], activityOrder: [], minStops: 4, maxStops: 6 } };
  const candidates = await hydrateDateCandidates(found.filter(candidate => !isOffDateVenue(candidate)), []);
  const catalog = discoveryCatalog(candidates, state, new Set(), 54);
  const fallback = buildFallbackCourse(catalog, state, new Set());
  const evaluation = evaluateCourse(fallback, catalog, state, new Set());
  console.info("trip_region_quality", JSON.stringify({ city: city.name, candidates: candidates.length,
    officialSourced: candidates.filter(candidate => candidate.externalSource === "tourapi" && candidate.evidence?.length).length,
    stops: evaluation.rows.map(row => ({ day: (row.day_index ?? 0) + 1,
      name: catalog.find(candidate => dateCandidateKey(candidate) === row.id)?.name,
      role: candidateActivitySlot(catalog.find(candidate => dateCandidateKey(candidate) === row.id)!),
    })), evidence: evaluation.evidenceCount, hardProblems: hardCourseProblems(evaluation.problems) }));
});
