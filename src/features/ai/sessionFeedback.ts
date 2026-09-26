import type { DateFeedback } from "./dateTurnUnderstanding";

export const MAX_SESSION_FEEDBACK = 40;
export type SessionFeedbackTarget = { kind: "plan_item" | "place";
  candidateId?: string; venueId?: string; name: string };
export type SessionFeedbackEntry = {
  target: SessionFeedbackTarget | null;
  attribute: string;
  sentiment: DateFeedback["sentiment"];
  strength: number;
  confidence: number;
  sourceTurn: string;
  observedAt: string;
  source: "llm" | "deterministic" | "legacy";
};
export type SessionFeedbackContext = { version: 1; entries: SessionFeedbackEntry[] };

export const emptySessionFeedback = (): SessionFeedbackContext => ({ version: 1, entries: [] });

/** Session-only read state. There is no DB or couple-profile write in this module. */
export function mergeSessionFeedback(previous: SessionFeedbackContext | null | undefined,
  incoming: SessionFeedbackEntry[]): SessionFeedbackContext {
  const entries = [...(previous?.entries ?? [])];
  for (const entry of incoming) {
    const key = (item: SessionFeedbackEntry) => [item.sourceTurn, item.attribute,
      item.sentiment, item.target?.candidateId ?? item.target?.venueId ?? item.target?.name ?? ""].join("\u0000");
    if (!entries.some(item => key(item) === key(entry))) entries.push({ ...entry,
      target: entry.target ? { ...entry.target } : null });
  }
  return { version: 1, entries: entries.slice(-MAX_SESSION_FEEDBACK) };
}

export type PlaceSessionFeedbackSignal = { attribute: string;
  sentiment: DateFeedback["sentiment"]; targetName?: string;
  targetCandidateId?: string; priority: "current_feedback" | "older_session_feedback" };

/** Only verified venue feedback becomes a soft selector signal; it never labels another venue. */
export function placeSessionFeedbackSignals(context: SessionFeedbackContext | null | undefined,
  currentTurn: string): PlaceSessionFeedbackSignal[] {
  return (context?.entries ?? []).filter(entry => entry.target && entry.confidence >= 0.75)
    .slice(-12).map(entry => ({ attribute: entry.attribute, sentiment: entry.sentiment,
      targetName: entry.target!.name,
      ...(entry.target!.candidateId ? { targetCandidateId: entry.target!.candidateId } : {}),
      priority: entry.sourceTurn === currentTurn ? "current_feedback" : "older_session_feedback" }));
}
