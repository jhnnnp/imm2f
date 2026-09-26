import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateTaskObjectives, runDateTaskPlanner } from "./dateTaskPlanner";

const candidate = (id: string) => ({ externalSource: "kakao", externalPlaceId: id,
  name: `전시 ${id}`, category: "photo", coordinates: [127, 37.5] }) as DiscoverCandidate;

describe("date task planner", () => {
  it("decomposes dated rain, food, budget and schedule requirements", () => {
    const state = { ...emptyDateBrief(), dateLabel: "2026-09-26", activities: ["exhibit" as const],
      excludedFoods: ["해산물"], budgetWon: 150000, startTime: "15:00", endTime: "22:00",
      userRequests: ["비 온다던데 잠실에서 전시 보고 해산물 빼고 15만원에 10시 전에 집 가야 해"] };
    const ids = dateTaskObjectives(state).map(task => task.id);
    expect(ids).toEqual(expect.arrayContaining([
      "candidate_coverage", "venue_evidence", "event_date", "food_restriction",
      "weather", "budget", "schedule", "route",
    ]));
  });

  it("replans from observed search results and stops when the missing role is covered", async () => {
    const state = emptyDateBrief();
    const attempted = new Set<string>();
    let pool = Array.from({ length: 8 }, (_, index) => candidate(String(index)));
    let missing: Array<"exhibit"> = ["exhibit"];
    const seen: number[] = [];
    const result = await runDateTaskPlanner({
      state, regions: ["잠실"], attempted,
      observe: () => ({ candidates: pool, missingActivities: missing }),
      nextActions: async input => {
        seen.push(input.previousSteps?.length ?? 0);
        return [{ tool: "search_places", region: "잠실", query: "잠실 전시" }];
      },
      execute: async () => { pool = [...pool, candidate("new")]; missing = []; },
    });
    expect(seen).toEqual([0]);
    expect(result.stopReason).toBe("satisfied");
    expect(result.steps[0].newCandidateIds).toEqual(["kakao:new"]);
    expect(result.unresolvedActivities).toEqual([]);
    expect(attempted).toContain("잠실:잠실 전시");
  });

  it("halts duplicate-only work and reports the unresolved task", async () => {
    const state = emptyDateBrief();
    const attempted = new Set<string>();
    let executions = 0;
    const result = await runDateTaskPlanner({
      state, regions: ["잠실"], attempted,
      observe: () => ({ candidates: [candidate("same")], missingActivities: ["meal"] }),
      nextActions: async () => [{ tool: "search_places", region: "잠실", query: "잠실 식당" }],
      execute: async () => { executions++; },
    });
    expect(executions).toBe(1);
    expect(result.stopReason).toBe("no_progress");
    expect(result.unresolvedActivities).toEqual(["meal"]);
  });

  it("treats newly verified performances as progress without adding a venue", async () => {
    const state = { ...emptyDateBrief(), dateLabel: "2026-10-09", activities: ["performance" as const] };
    const hall = { ...candidate("hall"), name: "소월아트홀", categoryLabel: "공연장",
      detailedCategory: "공연장" };
    const others = Array.from({ length: 7 }, (_, index) => candidate(`other-${index}`));
    let pool = [hall, ...others];
    const result = await runDateTaskPlanner({
      state, regions: ["왕십리"], attempted: new Set(), canVerifyPerformances: true,
      observe: () => ({ candidates: pool, missingActivities: [] }),
      nextActions: async () => [{ tool: "verify_performance", venueId: "kakao:hall" }],
      execute: async () => { pool = [{ ...hall, performanceEvent: { id: "PF1", title: "공연",
        dateYmd: "20261009", showtimes: ["19:00"], genre: "연극", sourceUrl: "https://example.com",
        checkedAt: new Date().toISOString() } }, ...others]; },
    });
    expect(result.steps[0].newVerifiedEvents).toBe(1);
    expect(result.steps[0].newCandidateIds).toEqual([]);
    expect(result.stopReason).toBe("satisfied");
  });

  it("tries a different venue search after event verification finds no dated show", async () => {
    const state = { ...emptyDateBrief(), dateLabel: "2026-10-09", activities: ["performance" as const] };
    const hall = { ...candidate("hall"), name: "소월아트홀", categoryLabel: "공연장",
      detailedCategory: "공연장" };
    let pool = [hall, ...Array.from({ length: 7 }, (_, index) => candidate(`other-${index}`))];
    const result = await runDateTaskPlanner({
      state, regions: ["왕십리"], attempted: new Set(), canVerifyPerformances: true,
      observe: () => ({ candidates: pool, missingActivities: ["performance"] }),
      nextActions: async input => input.previousSteps?.length
        ? [{ tool: "search_places", region: "왕십리", query: "왕십리 공연" }]
        : [{ tool: "verify_performance", venueId: "kakao:hall" }],
      execute: async calls => { if (calls[0].tool === "search_places") pool = [...pool, candidate("new")]; },
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].newVerifiedEvents).toBe(0);
    expect(result.steps[1].newCandidateIds).toEqual(["kakao:new"]);
  });

  it("enforces a total call budget even when the model keeps requesting searches", async () => {
    const state = emptyDateBrief();
    let pool: DiscoverCandidate[] = [];
    const result = await runDateTaskPlanner({
      state, regions: ["잠실"], attempted: new Set(), maxRounds: 3, maxCalls: 2,
      observe: () => ({ candidates: pool, missingActivities: ["meal"] }),
      nextActions: async () => Array.from({ length: 4 }, (_, index) =>
        ({ tool: "search_places" as const, region: "잠실", query: `잠실 식당 ${index}` })),
      execute: async () => { pool = [candidate("one")]; },
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].calls).toHaveLength(2);
    expect(result.stopReason).toBe("budget_exhausted");
  });

  it("counts newly retrieved place facts as tool progress", async () => {
    const state = { ...emptyDateBrief(), budgetWon: 80000 };
    const base = Array.from({ length: 8 }, (_, index) => candidate(String(index)));
    let pool = base;
    const result = await runDateTaskPlanner({ state, regions: ["성수"], attempted: new Set(), canInspectPlaces: true,
      observe: () => ({ candidates: pool, missingActivities: [] }),
      nextActions: async () => [{ tool: "get_place_details", venueId: "kakao:0" }],
      execute: async () => { pool = [{ ...base[0], expectedCostTwo: 30000 }, ...base.slice(1)]; },
    });
    expect(result.steps[0].newDetailedPlaces).toBe(1);
    expect(result.steps[0].newCandidateIds).toEqual([]);
  });
});
