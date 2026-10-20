import { describe, expect, it } from "vitest";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { runDateAgentCourse } from "./dateAgentOrchestrator";

const candidate = (id: string) => ({ externalSource: "kakao", externalPlaceId: id }) as DiscoverCandidate;
const reply = (success: boolean, issues: string[] = []) => ({
  items: success ? [{ id: "plan" }] : [], design: { rejectionReasons: issues },
}) as unknown as AIPlannerReply;

describe("date course agent orchestration", () => {
  it("researches new candidates once after verification fails, then replans", async () => {
    const observed: number[] = [];
    const result = await runDateAgentCourse({ candidates: [candidate("a")],
      propose: async candidates => { observed.push(candidates.length);
        return reply(candidates.length > 1, ["실제 보행 경로와 지정한 시간의 충돌"]); },
      researchAfterFailure: async issues => { expect(issues).toContain("실제 보행 경로와 지정한 시간의 충돌");
        return [candidate("b")]; },
    });
    expect(observed).toEqual([1, 2]);
    expect(result.attempts).toBe(2);
    expect(result.newCandidatesOnRepair).toBe(1);
    expect(result.reply.items).toHaveLength(1);
  });

  it("does not rerun a plan when research only rediscovers the same venue", async () => {
    let attempts = 0;
    const result = await runDateAgentCourse({ candidates: [candidate("a")],
      propose: async () => { attempts++; return reply(false); },
      researchAfterFailure: async () => [candidate("a")],
    });
    expect(attempts).toBe(1);
    expect(result.attempts).toBe(1);
  });

  it("replans for new exact-venue evidence even when the provider identity is unchanged", async () => {
    const observations: Array<DiscoverCandidate[]> = [];
    const result = await runDateAgentCourse({ candidates: [candidate("a")],
      propose: async candidates => { observations.push(candidates);
        return reply(Boolean(candidates[0].openingHours), ["영업시간 확인 필요"]); },
      researchAfterFailure: async () => [{ ...candidate("a"), openingHours: "11:00–21:00" }],
    });
    expect(result.attempts).toBe(2);
    expect(result.newCandidatesOnRepair).toBe(0);
    expect(observations[1][0].openingHours).toBe("11:00–21:00");
    expect(result.reply.items).toHaveLength(1);
  });

  it("preserves sourced evidence when a search rediscovers the same venue with sparse details", async () => {
    const evidence = [{ id: "garden", text: "정원 좌석이 안내되어 있어요.", url: "https://example.com/a", checkedAt: "2026-10-20" }];
    const result = await runDateAgentCourse({ candidates: [{ ...candidate("a"), evidence, openingHours: "11:00–21:00" }],
      propose: async candidates => reply(candidates.length > 1),
      researchAfterFailure: async () => [candidate("a"), candidate("b")],
    });
    expect(result.candidates[0].evidence).toEqual(evidence);
    expect(result.candidates[0].openingHours).toBe("11:00–21:00");
  });

  it("keeps the original truthful failure when repair research is unavailable", async () => {
    const first = reply(false, ["실제 보행 경로 미확인"]);
    const result = await runDateAgentCourse({ candidates: [candidate("a")], propose: async () => first,
      researchAfterFailure: async () => { throw new Error("provider unavailable"); },
    });
    expect(result.reply).toBe(first);
    expect(result.attempts).toBe(1);
  });

  it("does not search around an unverified food allergy", async () => {
    let searched = false;
    await runDateAgentCourse({ candidates: [candidate("a")],
      propose: async () => reply(false, ["알레르기 안전성 미확인"]),
      researchAfterFailure: async () => { searched = true; return [candidate("b")]; },
    });
    expect(searched).toBe(false);
  });
  it("does not research around a provably impossible chosen itinerary", async () => {
    let searched = false;
    const first = reply(false);
    first.design!.feasibility = { passed: false, reason: "selected_stays_exceed_time", message: "시간 부족" };
    const result = await runDateAgentCourse({ candidates: [candidate("a")], propose: async () => first,
      researchAfterFailure: async () => { searched = true; return [candidate("b")]; } });
    expect(searched).toBe(false);
    expect(result.attempts).toBe(1);
  });
});
