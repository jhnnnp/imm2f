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

  it("does not search around an unverified food allergy", async () => {
    let searched = false;
    await runDateAgentCourse({ candidates: [candidate("a")],
      propose: async () => reply(false, ["알레르기 안전성 미확인"]),
      researchAfterFailure: async () => { searched = true; return [candidate("b")]; },
    });
    expect(searched).toBe(false);
  });
});
