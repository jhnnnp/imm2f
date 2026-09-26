import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { buildDateCandidatePool } from "./dateCandidatePool";
import type { DateExecutionPlan, DateExecutionTask } from "./dateExecutionPlan";
import { executeLimitedFeedback } from "./dateFeedbackExecution";
import type { DateTurnUnderstanding } from "./dateTurnUnderstanding";
import { mergeSessionCandidates } from "./sessionCandidates";
import { mergeSessionFeedback, placeSessionFeedbackSignals } from "./sessionFeedback";

const message = "a 카페는 예쁜데 너무 시끄러워";
const venue: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "a", name: "a 카페",
  category: "cafe", categoryLabel: "카페", kakaoCategoryGroupCode: "CE7", district: "성수",
  address: "서울 성수 a", roadAddress: "서울 성수 a", phone: "", mapUrl: "",
  coordinates: [127.04, 37.56], searchRegion: "성수" };
const state = withAreas(emptyDateBrief(), ["성수"]);
const session = () => mergeSessionCandidates(null, buildDateCandidatePool([venue], state).records,
  { sessionId: "s", turnId: "s:1", observedAt: "2026-09-26T10:00:00Z",
    shownPlaces: [{ name: "a 카페", address: "서울 성수 a" }] });
const target = { kind: "previous_place" as const, text: "a 카페", resolvedId: "kakao:a",
  resolvedName: "a 카페", targetType: "place" as const, confidence: 0.95 };
const understanding: DateTurnUnderstanding = { rawMessage: message,
  goals: [{ type: "provide_feedback", confidence: 0.9 }], references: [target],
  explicitConstraints: {}, semanticPreferences: [], requestedChanges: [], ambiguities: [],
  confidence: 0.9, provenance: [], feedback: [
    { target, attribute: "aesthetic", sentiment: "positive", strength: 0.8,
      confidence: 0.9, explicit: true, source: "llm", evidenceText: "예쁜데" },
    { target, attribute: "noise", sentiment: "negative", strength: 0.9,
      confidence: 0.9, explicit: true, source: "llm", evidenceText: "너무 시끄러워" },
  ] };
const task: DateExecutionTask = { id: "feedback", type: "record_feedback", goal: "provide_feedback",
  dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned", source: "llm",
  feedback: understanding.feedback.map(row => ({ attribute: row.attribute, sentiment: row.sentiment,
    target: { kind: "place", name: "a 카페", placeId: "kakao:a" } })) };
const plan: DateExecutionPlan = { tasks: [task], unresolved: [], executable: true,
  source: "effective_understanding" };
const run = (overrides: Partial<Parameters<typeof executeLimitedFeedback>[0]> = {}) =>
  executeLimitedFeedback({ plan, task, interpreterMode: "assist", executionMode: "limited",
    currentPlan: null, visiblePlaces: [], sessionCandidates: session(), understanding,
    userMessage: message, turnId: "s:2", now: "2026-09-26T11:00:00Z", ...overrides });

describe("session-level feedback execution", () => {
  it("keeps separate positive aesthetic and negative noise feedback for a verified venue", async () => {
    const outcome = await run();
    expect(outcome.result.status).toBe("success");
    expect(outcome.result.entries.map(row => [row.attribute, row.sentiment])).toEqual([
      ["aesthetic", "positive"], ["noise", "negative"]]);
    expect(outcome.result.entries.every(row => row.target?.candidateId === "kakao:a")).toBe(true);
    const snapshot = session();
    snapshot.feedback = mergeSessionFeedback(snapshot.feedback, outcome.result.entries);
    expect(placeSessionFeedbackSignals(snapshot.feedback, "s:2")).toMatchObject([
      { attribute: "aesthetic", priority: "current_feedback" },
      { attribute: "noise", priority: "current_feedback" },
    ]);
    expect(snapshot.feedback?.entries).toHaveLength(2);
    const nextTurn = mergeSessionCandidates(snapshot, [], { sessionId: "s", turnId: "s:3",
      observedAt: "2026-09-26T12:00:00Z" });
    expect(placeSessionFeedbackSignals(nextTurn.feedback, "s:3")[0].priority).toBe("older_session_feedback");
    expect(mergeSessionCandidates(nextTurn, [], { sessionId: "s", turnId: "s:4",
      observedAt: "2026-09-26T13:00:00Z", reset: true }).feedback?.entries).toEqual([]);
  });

  it("keeps an unresolved target null instead of inventing an ID", async () => {
    const unresolved = { ...task, feedback: task.feedback?.map(row => ({ ...row,
      target: { kind: "place" as const, name: "a 카페", placeId: "kakao:fake" } })) };
    const outcome = await run({ task: unresolved, plan: { ...plan, tasks: [unresolved] } });
    expect(outcome.result.entries.every(row => row.target === null)).toBe(true);
    expect(outcome.result.unresolvedTargetCount).toBe(2);
    expect(placeSessionFeedbackSignals(mergeSessionFeedback(null, outcome.result.entries), "s:2")).toEqual([]);
  });

  it("does not promote a weak or ungrounded feedback row", async () => {
    const weak = { ...understanding, feedback: [{ ...understanding.feedback[0], confidence: 0.5 }] };
    expect((await run({ understanding: weak })).result.entries).toEqual([]);
    const invented = { ...understanding, feedback: [{ ...understanding.feedback[0], evidenceText: "무료 주차" }] };
    expect((await run({ understanding: invented })).result.entries).toEqual([]);
  });

  it("does not execute outside ASSIST plus limited", async () => {
    expect((await run({ interpreterMode: "off" })).result.status).toBe("skipped");
    expect((await run({ interpreterMode: "shadow" })).result.status).toBe("skipped");
    expect((await run({ executionMode: "shadow" })).result.status).toBe("skipped");
  });
});
