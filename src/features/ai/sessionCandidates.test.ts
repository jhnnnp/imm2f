import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { buildDateCandidatePool, type DateCandidateRecord } from "./dateCandidatePool";
import { candidateSessionObservation } from "./dateObservation";
import { candidateSessionIdentity, emptySessionCandidates, getReusableCandidates,
  isSessionEvidenceStale, MAX_SESSION_CANDIDATES, mergeSessionCandidates,
  resolveSessionRejectedReference, resolveSessionShownReference, sealSessionCandidates,
  verifiedSessionCandidates, type SessionCandidateContext } from "./sessionCandidates";

const at = "2026-09-26T10:00:00.000Z";
const candidate = (id: string, name = id, changes: Partial<DiscoverCandidate> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name, category: "cafe", categoryLabel: "카페",
  district: "성동구", address: "서울 성동구 성수동 1", roadAddress: "서울 성동구 성수로 1",
  phone: "", mapUrl: "", coordinates: [127.04, 37.56], ...changes,
});
const records = (...places: DiscoverCandidate[]) => buildDateCandidatePool(places, emptyDateBrief()).records;
const info = (turn: number, changes: Partial<Parameters<typeof mergeSessionCandidates>[2]> = {}) => ({
  sessionId: "session-a", turnId: `session-a:${turn}`, observedAt: at, ...changes,
});
const plan = (place: DiscoverCandidate): AIPlannerReply => ({ status: "plan", message: "코스",
  card: { headline: "코스", lines: ["코스"] }, condition: { dateLabel: "2026-09-26",
    startTime: "15:00", endTime: "21:00", budget: null, region: "성수", timeSpecified: true },
  recommendations: [{ id: `kakao:${place.externalPlaceId}`, placeId: `discover:kakao:${place.externalPlaceId}`,
    name: place.name, activitySlot: "cafe", category: "카페", district: "성동구", address: place.address,
    phone: "", mapUrl: "", coordinates: place.coordinates, durationMinutes: 60, expectedCost: 0,
    reasons: [], isSaved: false, distanceFromPreviousMeters: null }],
  items: [{ id: `item-${place.externalPlaceId}`, placeId: `discover:kakao:${place.externalPlaceId}`,
    placeName: place.name, category: "카페", startTime: "15:00", durationMinutes: 60,
    expectedCost: 0, order: 0, memo: "", dayIndex: 0 }], candidateCount: 1,
  source: "fallback", state: emptyDateBrief() });

describe("session candidate context", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("merges the same A/B/C provider candidates across turns without duplicate records", () => {
    const pool = records(candidate("a"), candidate("b"), candidate("c"));
    const first = mergeSessionCandidates(null, pool, info(1));
    const second = mergeSessionCandidates(first, pool, info(2));
    expect(first.records).toHaveLength(3);
    expect(second.records).toHaveLength(3);
    expect(second.records[0].facts.map(fact => fact.turnId)).toEqual(["session-a:1", "session-a:2"]);
    expect(second.records[0].events.filter(event => event.type === "discovered")).toHaveLength(1);
  });

  it("separates shown A/B from unseen eligible C and exposes only their IDs", () => {
    const context = mergeSessionCandidates(null, records(candidate("a"), candidate("b"), candidate("c")),
      info(1, { shownPlaces: [{ name: "a" }, { name: "b" }] }));
    expect(context.shownCandidateIds).toEqual(["kakao:a", "kakao:b"]);
    expect(getReusableCandidates(context, at).unseenEligibleIds).toEqual(["kakao:c"]);
    expect(getReusableCandidates(context, at).alreadyShownIds).toEqual(["kakao:a", "kakao:b"]);
  });

  it("keeps B selected and records B replaced when C becomes the verified current plan", () => {
    const b = candidate("b"); const c = candidate("c");
    const first = mergeSessionCandidates(null, records(b, c), info(1, { currentPlan: plan(b) }));
    expect(first.selectedCandidateIds).toEqual(["kakao:b"]);
    const second = mergeSessionCandidates(first, [], info(2, { previousPlan: plan(b), currentPlan: plan(c) }));
    expect(second.records.find(row => row.candidateId === "kakao:b")?.currentState).toBe("replaced");
    expect(second.selectedCandidateIds).toEqual(["kakao:c"]);
    expect(second.records.find(row => row.candidateId === "kakao:b")?.events.at(-1)?.type).toBe("replaced");
  });

  it("retains a prior exact rejection reason and its candidate-pool provenance", () => {
    const rejected = buildDateCandidatePool([candidate("a", "A 카페")],
      { ...emptyDateBrief(), excludedPlaces: ["A 카페"] }).records;
    const first = mergeSessionCandidates(null, rejected, info(1));
    const next = mergeSessionCandidates(first, [], info(2));
    expect(getReusableCandidates(next, at).priorRejectedReasons["kakao:a"]).toEqual(["excluded_place"]);
    expect(resolveSessionRejectedReference(next, "왜 아까 A 카페 안 넣었어?")?.candidateId).toBe("kakao:a");
    expect(next.records[0].events).toContainEqual(expect.objectContaining({ type: "rejected",
      reason: "excluded_place", source: "candidate_pool", turnId: "session-a:1" }));
    let repeated = next;
    for (let turn = 3; turn < 20; turn++) repeated = mergeSessionCandidates(repeated,
      records(candidate("a", "A 카페")), info(turn));
    expect(repeated.records[0].events.some(event => event.type === "rejected"
      && event.reason === "excluded_place")).toBe(true);
  });

  it("does not invent a rejection reason when none was observed", () => {
    const context = mergeSessionCandidates(null, records(candidate("a")), info(1));
    expect(resolveSessionRejectedReference(context, "왜 아까 a 안 넣었어?")).toBeNull();
    expect(getReusableCandidates(context, at).priorRejectedReasons).toEqual({});
  });

  it("resolves an ordinal only within the last shown batch and leaves ambiguous '아까 거' unresolved", () => {
    const context = mergeSessionCandidates(null, records(candidate("a"), candidate("b"), candidate("c")),
      info(1, { shownPlaces: [{ name: "b" }, { name: "a" }, { name: "c" }] }));
    expect(resolveSessionShownReference(context, "아까 보여준 첫 번째 카페")?.candidateId).toBe("kakao:b");
    expect(resolveSessionShownReference(context, "아까 보여준 첫 번째 a 카페")).toBeNull();
    expect(resolveSessionShownReference(context, "아까 거")).toBeNull();
  });

  it("uses stable provider ID despite a changed name", () => {
    const first = mergeSessionCandidates(null, records(candidate("same", "옛 이름")), info(1));
    const second = mergeSessionCandidates(first, records(candidate("same", "새 이름")), info(2));
    expect(second.records).toHaveLength(1);
    expect(second.records[0].name).toBe("새 이름");
  });

  it("never merges equal names at different provider IDs or fallback locations", () => {
    const a = candidate("a", "같은 이름", { address: "성수 1" });
    const b = candidate("b", "같은 이름", { address: "성수 2" });
    const context = mergeSessionCandidates(null, records(a, b), info(1, { shownPlaces: [{ name: "같은 이름" }] }));
    expect(context.records).toHaveLength(2);
    expect(context.shownCandidateIds).toEqual([]);
    expect(candidateSessionIdentity({ name: "같은 이름", address: "성수 1", category: "cafe" }))
      .not.toEqual(candidateSessionIdentity({ name: "같은 이름", address: "성수 2", category: "cafe" }));
    expect(candidateSessionIdentity({ name: "같은 이름" })).toBeNull();
  });

  it("retains evidence provenance and detects old opening-hour facts as stale", () => {
    const old: DateCandidateRecord = { ...records(candidate("hours"))[0], evidence: [{
      venueId: "kakao:hours", attribute: "hours", sourceType: "maps", sourceUrl: "https://example.com/hours",
      retrievedAt: "2026-09-20T10:00:00Z", confidence: 0.6, verification: "provider" }] };
    const context = mergeSessionCandidates(null, [old], info(1));
    const evidence = context.records[0].evidence[0];
    expect(evidence).toMatchObject({ sourceUrl: "https://example.com/hours", observedTurnId: "session-a:1",
      freshnessCategory: "time_sensitive" });
    expect(isSessionEvidenceStale(evidence, at)).toBe(true);
    expect(getReusableCandidates(context, at).stale).toHaveLength(1);
  });

  it("marks an unseen candidate stale after seven days without refreshing it", () => {
    const first = mergeSessionCandidates(null, records(candidate("old")),
      info(1, { observedAt: "2026-09-01T10:00:00Z" }));
    const later = mergeSessionCandidates(first, [], info(2));
    expect(later.records[0].currentState).toBe("stale");
    expect(later.records[0].events.at(-1)?.type).toBe("stale");
    expect(later.records[0].facts).toEqual(first.records[0].facts);
  });

  it("prunes unseen low-value records before shown, selected, or reasoned rejections", () => {
    const many = records(...Array.from({ length: MAX_SESSION_CANDIDATES + 5 }, (_, i) => candidate(String(i))));
    const rejected: DateCandidateRecord = { ...many[2], rejectedReasons: ["excluded_place"] };
    many[2] = rejected;
    const context = mergeSessionCandidates(null, many, info(1, { shownPlaces: [{ name: "1" }],
      currentPlan: plan(candidate("0")) }));
    expect(context.records).toHaveLength(MAX_SESSION_CANDIDATES);
    expect(context.records.map(row => row.candidateId)).toEqual(expect.arrayContaining([
      "kakao:0", "kakao:1", "kakao:2" ]));
  });

  it("resets when the session ID changes or reset is explicit", () => {
    const first = mergeSessionCandidates(null, records(candidate("old")), info(1));
    const changed = mergeSessionCandidates(first, records(candidate("new")),
      info(1, { sessionId: "session-b", turnId: "session-b:1" }));
    expect(changed.records.map(row => row.candidateId)).toEqual(["kakao:new"]);
    const reset = mergeSessionCandidates(first, [], info(2, { reset: true }));
    expect(reset.records).toEqual([]);
  });

  it("rejects a tampered client-carried context", () => {
    vi.stubEnv("SESSION_CANDIDATE_SIGNING_KEY", "test-only-signing-key");
    const sealed = sealSessionCandidates(mergeSessionCandidates(null, records(candidate("a")), info(1)));
    expect(verifiedSessionCandidates(sealed, "session-a")?.records).toHaveLength(1);
    const tampered: SessionCandidateContext = { ...sealed, records: [{ ...sealed.records[0],
      rejectedReasons: ["excluded_place"] }] };
    expect(verifiedSessionCandidates(tampered, "session-a")).toBeNull();
    expect(verifiedSessionCandidates(sealed, "other-session")).toBeNull();
  });

  it("emits only aggregate candidate-session diagnostics", () => {
    const current = mergeSessionCandidates(null, records(candidate("a")), info(1));
    const observation = candidateSessionObservation(null, current, records(candidate("a")), at);
    expect(observation).toMatchObject({ type: "candidate_session", data: {
      totalCandidates: 1, newCandidates: 1, mergedCandidates: 0, shownCount: 0 } });
    expect(JSON.stringify(observation)).not.toContain("성수동");
  });
});
