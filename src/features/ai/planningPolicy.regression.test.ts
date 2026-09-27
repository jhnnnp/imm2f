import { describe, expect, it } from "vitest";
import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { dateCandidateKey, validateModelRows } from "./dateCourse";
import { evaluateCourse, feasibleCourseSeeds } from "./courseDesign";
import { blocksCourse } from "./planningPolicy";

const candidates: DiscoverCandidate[] = Array.from({ length: 9 }, (_, index) => ({
  externalSource: "kakao", externalPlaceId: `policy-${index}`, name: `장소 ${index}`,
  category: (["tourist", "restaurant", "cafe"] as const)[index % 3],
  categoryLabel: ["관광지", "음식점", "카페"][index % 3], district: "부산",
  address: "부산", roadAddress: "", phone: "", mapUrl: "",
  coordinates: [129.04 + index * 0.001, 35.1], expectedCostTwo: 20000,
  evidence: [{ id: `e${index}`, text: "정원과 야외 테라스 좌석이 있습니다.",
    url: `https://example.com/${index}`, checkedAt: "2026-09-26" }],
}));

const scenarios: Array<[string, Partial<AIPlannerState>, number[]]> = [
  ["busan_three_days", { stayKind: "overnight", nights: 2 }, [0, 0, 1, 1, 1, 2, 2]],
  ["late_arrival", { stayKind: "overnight", nights: 2, userRequests: ["첫날 오후 7시 도착"] }, [0, 0, 1, 1, 1, 2, 2]],
  ["early_departure", { stayKind: "overnight", nights: 2, userRequests: ["마지막 날 오후 2시 출발"] }, [0, 0, 1, 1, 1, 2, 2]],
  ["rest_trip", { stayKind: "overnight", nights: 2, userRequests: ["휴양 위주로 여유롭게"] }, [0, 1, 2]],
  ["cafe_tour", { activities: ["cafe"], userRequests: ["카페 투어만 할래"] }, [0, 0, 0]],
  ["short_evening", { timeWindow: "evening", startTime: "19:00", endTime: "21:00" }, [0, 0]],
  ["hard_constraints", { budgetWon: 10000, requiredPlaces: ["없는 필수 장소"], excludedPlaces: ["장소 0"] }, [0, 0, 0]],
  ["daytrip", { stayKind: "daytrip" }, [0, 0, 0, 0]],
];

// The immutable P1-A baseline lives in docs/planning-policy-p1a-baseline.snap.
// P1-B intentionally changes score and minimum fill, so guard hard safety and
// ID integrity instead of comparing obsolete policy-sensitive hashes.
describe("P1-B policy regression", () => {
  it.each(scenarios)("checks %s", (name, patch, dayIndices) => {
    const state = { ...withAreas(emptyDateBrief(), ["부산"]), dateLabel: "2026-10-06", ...patch };
    const proposal = { theme: "baseline", rows: dayIndices.map((day_index, index) => ({
      id: dateCandidateKey(candidates[index]), day_index,
    })) };
    const evaluation = evaluateCourse(proposal, candidates, state, new Set());
    const rewritten = validateModelRows(proposal.rows, candidates, state);
    const seeds = feasibleCourseSeeds(candidates, state, new Set());
    expect(evaluation.rows.every(row => candidates.some(candidate => dateCandidateKey(candidate) === row.id))).toBe(true);
    expect(rewritten.every(row => candidates.some(candidate => dateCandidateKey(candidate) === row.id))).toBe(true);
    expect(seeds.every(seed => !blocksCourse(seed.issues, "deterministic_seed"))).toBe(true);
    expect(blocksCourse(evaluation.issues, "model_proposal")).toBe(name === "hard_constraints");
  });
});
