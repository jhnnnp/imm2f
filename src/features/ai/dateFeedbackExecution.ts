import type { AIChatStop, AIPlannerReply } from "@/features/planning/types/plan";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import type { DateExecutionMode } from "./dateVenueInspection";
import type { DateExecutionPlan, DateExecutionTarget, DateExecutionTask } from "./dateExecutionPlan";
import type { DateObservation } from "./dateObservation";
import type { DateTurnUnderstanding, DateFeedback } from "./dateTurnUnderstanding";
import type { SessionCandidateContext } from "./sessionCandidates";
import type { SessionFeedbackEntry, SessionFeedbackTarget } from "./sessionFeedback";

export type FeedbackTaskExecutionResult = { taskId: string; taskType: "record_feedback";
  status: "success" | "skipped" | "failed"; source: "verified_turn_feedback";
  coveredByLegacyRoute: false; entries: SessionFeedbackEntry[];
  unresolvedTargetCount: number;
  failureCode?: "mode_disabled" | "interpreter_disabled" | "not_planned"
    | "low_confidence" | "unsupported_condition" | "no_verified_feedback" };

const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();

export function verifiedFeedbackExecutionTarget(target: DateExecutionTarget | undefined,
  currentPlan: AIPlannerReply | null, visiblePlaces: AIChatStop[],
  sessionCandidates?: SessionCandidateContext | null): SessionFeedbackTarget | null {
  if (!target || target.kind === "plan") return null;
  if (target.kind === "plan_item") {
    const found = currentPlan?.recommendations.filter(place => place.placeId === target.placeId
      && place.name === target.name) ?? [];
    return found.length === 1 ? { kind: "plan_item", name: found[0].name,
      venueId: found[0].placeId,
      ...(/^(?:kakao|tourapi):\S+$/.test(found[0].id) ? { candidateId: found[0].id } : {}) } : null;
  }
  if (target.placeId) {
    const rows = sessionCandidates?.records.filter(row => row.candidateId === target.placeId
      && row.name === target.name && (row.shownCount > 0 || row.currentState === "selected"
        || row.rejectedReasons.length > 0)) ?? [];
    return rows.length === 1 ? { kind: "place", name: rows[0].name,
      candidateId: rows[0].candidateId,
      ...(rows[0].venueId ? { venueId: rows[0].venueId } : {}) } : null;
  }
  const visible = visiblePlaces.filter(stop => stop.name === target.name);
  if (visible.length !== 1) return null;
  const rows = sessionCandidates?.records.filter(row => row.name === target.name
    && row.address && visible[0].address && compact(row.address) === compact(visible[0].address)) ?? [];
  return { kind: "place", name: visible[0].name,
    ...(rows.length === 1 ? { candidateId: rows[0].candidateId } : {}) };
}

function approvedFeedback(row: NonNullable<DateExecutionTask["feedback"]>[number],
  understanding: DateTurnUnderstanding | null, message: string): DateFeedback | null {
  const matches = understanding?.feedback.filter(item => item.explicit && item.attribute === row.attribute
    && item.sentiment === row.sentiment && item.confidence >= 0.75
    && Boolean(item.evidenceText.trim()) && compact(message).includes(compact(item.evidenceText))) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export async function executeLimitedFeedback(input: { plan: DateExecutionPlan; task: DateExecutionTask;
  interpreterMode: DateTurnInterpreterMode; executionMode: DateExecutionMode;
  currentPlan: AIPlannerReply | null; visiblePlaces: AIChatStop[];
  sessionCandidates?: SessionCandidateContext | null;
  understanding: DateTurnUnderstanding | null; userMessage: string;
  turnId: string; now?: string }): Promise<{ result: FeedbackTaskExecutionResult;
    observation: DateObservation }> {
  const base: FeedbackTaskExecutionResult = { taskId: input.task.id, taskType: "record_feedback",
    status: "skipped", source: "verified_turn_feedback", coveredByLegacyRoute: false,
    entries: [], unresolvedTargetCount: 0 };
  const finish = (result: FeedbackTaskExecutionResult) => ({ result,
    observation: { type: "task_execution" as const, source: "date_feedback_execution" as const,
      timestamp: new Date().toISOString(), data: { taskType: "record_feedback" as const,
        status: result.status, entryCount: result.entries.length,
        unresolvedTargetCount: result.unresolvedTargetCount,
        failureCode: result.failureCode ?? null } } });
  const skip = (failureCode: NonNullable<FeedbackTaskExecutionResult["failureCode"]>) =>
    finish({ ...base, failureCode });
  if (input.executionMode !== "limited") return skip("mode_disabled");
  if (input.interpreterMode !== "assist") return skip("interpreter_disabled");
  if (input.task.type !== "record_feedback" || input.task.status !== "planned") return skip("not_planned");
  if (input.task.condition) return skip("unsupported_condition");
  if (input.task.confidence < 0.75) return skip("low_confidence");
  const entries: SessionFeedbackEntry[] = [];
  let unresolvedTargetCount = 0;
  const observedAt = input.now ?? new Date().toISOString();
  for (const row of input.task.feedback ?? []) {
    const original = approvedFeedback(row, input.understanding, input.userMessage);
    if (!original || !row.attribute || row.attribute === "overall") continue;
    const proposedTarget = verifiedFeedbackExecutionTarget(row.target, input.currentPlan,
      input.visiblePlaces, input.sessionCandidates);
    const target = original.target?.kind === "unresolved"
      || original.target?.resolvedName && original.target.resolvedName !== proposedTarget?.name
      || !original.target && row.target ? null : proposedTarget;
    if ((row.target || original.target) && !target) unresolvedTargetCount += 1;
    entries.push({ target, attribute: row.attribute, sentiment: row.sentiment,
      strength: Math.max(0, Math.min(1, original.strength)),
      confidence: original.confidence, sourceTurn: input.turnId, observedAt,
      source: original.source === "llm" ? "llm" : original.source === "deterministic"
        ? "deterministic" : "legacy" });
  }
  return entries.length ? finish({ ...base, status: "success", entries, unresolvedTargetCount })
    : skip("no_verified_feedback");
}
