import { describe, expect, it, vi } from "vitest";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { runDateAgentCourse } from "./dateAgentOrchestrator";
import { emptyDateBrief } from "@/features/ai/dateBrief";

const candidate = (id: string) => ({ externalSource: "kakao", externalPlaceId: id }) as DiscoverCandidate;
const reply = (success: boolean, issues: string[] = []) => ({
  items: success ? [{ id: "plan" }] : [], design: { rejectionReasons: issues },
}) as unknown as AIPlannerReply;

describe("date course agent orchestration", () => {
  const now = Date.parse("2026-10-20T13:00:00Z");
  const qualityVenue = (id: string, text?: string): DiscoverCandidate => ({
    externalSource: "kakao", externalPlaceId: id, name: "카페 " + id, category: "cafe", categoryLabel: "카페",
    district: "성수", address: "서울 성동구 성수이로 1", roadAddress: "서울 성동구 성수이로 1",
    phone: "", mapUrl: "https://place.map.kakao.com/" + id, coordinates: [127.04, 37.56],
    ...(text ? { evidence: [{ id: "fact-" + id, text, sourceExcerpt: text, venueId: "kakao:" + id,
      checkedAt: new Date(now - 1000).toISOString(), url: "https://example.com/" + id,
      verification: "source_checked" as const, attribute: "space" as const }] } : {}),
  });
  const qualityReply = (selected: DiscoverCandidate[]) => ({ ...reply(selected.length > 0),
    message: "조용한 공간을 골랐어요.", card: { headline: "데이트", lines: ["조용한 공간을 골랐어요."] },
    recommendations: selected.map(candidate => ({ id: "kakao:" + candidate.externalPlaceId })),
    items: selected.map(candidate => ({ id: candidate.externalPlaceId,
      placeId: "discover:kakao:" + candidate.externalPlaceId })) } as AIPlannerReply);
  const qualityContext = { state: emptyDateBrief(), message: "조용한 카페에서 대화하고 싶어", now };

  it("repairs a nonempty plan when explicit experience quality lacks evidence", async () => {
    const original = qualityVenue("first");
    const replacement = qualityVenue("second", "조용하고 한적한 좌석입니다.");
    const research = vi.fn(async (_issues, _candidates, assessment) => {
      expect(assessment?.researchNeeds[0].evidenceNeeded).toContain("noise");
      return [replacement];
    });
    const propose = vi.fn(async (pool: DiscoverCandidate[], assessment) => {
      if (assessment) expect(assessment.requirements[0].status).toBe("unknown");
      return qualityReply([pool.at(-1)!]);
    });
    const result = await runDateAgentCourse({ candidates: [original], propose,
      researchAfterFailure: research, qualityContext });
    expect(result.attempts).toBe(2);
    expect(result.quality?.needsRepair).toBe(false);
    expect(result.reply.recommendations[0].id).toBe("kakao:second");
    expect(research).toHaveBeenCalledOnce();
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("repairs selection without new network research when a sourced alternative already exists", async () => {
    const original = qualityVenue("ordinary");
    const alternative = qualityVenue("sourced", "조용한 실내 좌석입니다.");
    const research = vi.fn(async () => []);
    let attempts = 0;
    const result = await runDateAgentCourse({ candidates: [original, alternative], qualityContext,
      propose: async pool => qualityReply([pool[attempts++ ? 1 : 0]]), researchAfterFailure: research });
    expect(research).not.toHaveBeenCalled();
    expect(result.attempts).toBe(2);
    expect(result.quality?.requirements[0].status).toBe("supported");
  });

  it("keeps a feasible first plan when the targeted repair produces no itinerary", async () => {
    const original = qualityVenue("feasible");
    const addition = qualityVenue("not-feasible", "조용한 공간입니다.");
    let attempts = 0;
    const result = await runDateAgentCourse({ candidates: [original], qualityContext,
      propose: async () => qualityReply(attempts++ ? [] : [original]), researchAfterFailure: async () => [addition] });
    expect(result.reply.items).toHaveLength(1);
    expect(result.reply.recommendations[0].id).toBe("kakao:feasible");
    expect(result.reply.message).toContain("후보 일정");
    expect(result.reply.message).toContain("확인하지 못했어요");
    expect(result.reply.message).not.toContain("조용한 공간을 골랐어요");
  });

  it("does not accept a second feasible plan that contradicts an explicit quality", async () => {
    const original = qualityVenue("unknown");
    const worse = qualityVenue("noisy", "시끄럽고 혼잡한 좌석입니다.");
    let attempts = 0;
    const result = await runDateAgentCourse({ candidates: [original], qualityContext,
      propose: async () => qualityReply([attempts++ ? worse : original]), researchAfterFailure: async () => [worse] });
    expect(result.reply.recommendations[0].id).toBe("kakao:unknown");
    expect(result.quality?.requirements[0].status).toBe("unknown");
  });

  it("prioritizes zero explicit contradictions over resolving several unknown qualities", async () => {
    const original = qualityVenue("three-unknown");
    const worse = qualityVenue("one-contradiction", "시끄러운 공간입니다. 한옥 내부에서 전망을 볼 수 있습니다.");
    let attempts = 0;
    const result = await runDateAgentCourse({ candidates: [original],
      qualityContext: { ...qualityContext, message: "조용한 한옥 전망 카페로 골라줘" },
      propose: async () => qualityReply([attempts++ ? worse : original]),
      researchAfterFailure: async () => [worse] });
    expect(result.reply.recommendations[0].id).toBe("kakao:three-unknown");
    expect(result.quality?.requirements).toHaveLength(3);
    expect(result.quality?.requirements.every(item => item.status === "unknown")).toBe(true);
    expect(result.reply.items).toHaveLength(1);
  });

  it("compares the first itinerary again using its newly researched exact-branch evidence", async () => {
    const original = qualityVenue("improved-first");
    const enriched = qualityVenue("improved-first", "조용한 한옥 좌석에서 전망을 볼 수 있습니다.");
    const other = qualityVenue("still-unknown");
    let attempts = 0;
    const result = await runDateAgentCourse({ candidates: [original],
      qualityContext: { ...qualityContext, message: "조용한 한옥 전망 카페로 골라줘" },
      propose: async () => qualityReply([attempts++ ? other : original]),
      researchAfterFailure: async () => [enriched, other] });
    expect(result.reply.recommendations[0].id).toBe("kakao:improved-first");
    expect(result.quality?.requirements.every(item => item.status === "supported")).toBe(true);
    expect(result.quality?.needsRepair).toBe(false);
    expect(result.reply.card.followUp).toBeUndefined();
  });

  it("does not research an unknown inferred preference or call a completed plan fully verified", async () => {
    const original = qualityVenue("soft");
    const research = vi.fn(async () => []);
    const result = await runDateAgentCourse({ candidates: [original], propose: async () => qualityReply([original]),
      qualityContext: { state: { ...emptyDateBrief(), preferences: { vibe: ["조용한"], crowdTolerance: 0.2 } }, now },
      researchAfterFailure: research });
    expect(result.attempts).toBe(1);
    expect(result.quality?.requirements[0]).toMatchObject({ origin: "inferred_preference", status: "unknown" });
    expect(research).not.toHaveBeenCalled();
  });

  it("keeps explicit quality unknown when repair is disabled instead of claiming completion", async () => {
    const original = qualityVenue("disabled");
    const research = vi.fn(async () => []);
    const result = await runDateAgentCourse({ candidates: [original], qualityContext, allowResearchRepair: false,
      propose: async () => qualityReply([original]), researchAfterFailure: research });
    expect(result.attempts).toBe(1);
    expect(result.reply.items).toHaveLength(1);
    expect(result.reply.card.followUp).toContain("확인");
    expect(research).not.toHaveBeenCalled();
  });

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
