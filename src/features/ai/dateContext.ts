import type { AIPlannerReply, AIPlannerState, DateChatTurn } from "@/features/planning/types/plan";
import type { ArchivedDatePlan } from "@/features/planning/actions";
import type { TasteBoard } from "@/features/taste/types";
import type { DateTaskObjective } from "@/lib/openai/dateTaskPlanner";
import type { buildDateCandidatePool, DateCandidateRecord } from "./dateCandidatePool";
import type { DateMemoryContext } from "./dateMemory";
import { dateCandidateKey } from "./dateCourse";
import { toDateIntent, type DateIntent } from "./dateIntent";
import { candidateRecordObservations, type DateObservation } from "./dateObservation";
import type { DateTurnUnderstanding } from "./dateTurnUnderstanding";
import type { UnderstandingComparison } from "./dateTurnShadow";
import type { DateTurnInterpreterMode } from "@/lib/openai/dateTurnShadowRunner";
import type { SemanticSignalDecision } from "./dateTurnAssist";
import type { DateExecutionPlan, ExecutionPlanComparison } from "./dateExecutionPlan";
import type { SessionCandidateContext } from "./sessionCandidates";
import type { SessionFeedbackContext } from "./sessionFeedback";

export type DateContext = {
  conversation: DateChatTurn[];
  currentUnderstanding: DateTurnUnderstanding | null;
  shadowUnderstanding: DateTurnUnderstanding | null;
  effectiveUnderstanding: DateTurnUnderstanding | null;
  interpreterMode: DateTurnInterpreterMode;
  semanticSignalDiagnostics: SemanticSignalDecision[];
  understandingComparison: UnderstandingComparison | null;
  executionPlan: DateExecutionPlan | null;
  executionPlanComparison: ExecutionPlanComparison | null;
  objective: DateIntent["objective"];
  hardConstraints: DateIntent["hardConstraints"];
  softPreferences: DateIntent["preferences"];
  inferredPreferences: DateIntent["inferredPreferences"];
  coupleContext: {
    tasteBoard: TasteBoard | null;
    explicitProfile: DateMemoryContext["explicitProfile"] | null;
  };
  relevantMemories: {
    collected: DateMemoryContext | null;
    archivedPlans: ArchivedDatePlan[];
  };
  currentPlan: AIPlannerReply | null;
  goals: DateTaskObjective[];
  candidates: { records: DateCandidateRecord[]; eligibleIds: string[] };
  /** Session history is read-only here; current-turn pool records remain the execution input. */
  sessionCandidates: SessionCandidateContext | null;
  sessionFeedback: SessionFeedbackContext | null;
  observations: DateObservation[];
  facts: Array<Pick<DateCandidateRecord, "id" | "facts" | "evidence">>;
  uncertainties: string[];
  openQuestions: string[];
};

type CandidatePoolSnapshot = ReturnType<typeof buildDateCandidatePool>;

/** A pure read model. The recommendation pipeline continues to use AIPlannerState. */
export function buildDateContext(input: {
  state: AIPlannerState;
  conversation?: DateChatTurn[];
  currentUnderstanding?: DateTurnUnderstanding | null;
  shadowUnderstanding?: DateTurnUnderstanding | null;
  effectiveUnderstanding?: DateTurnUnderstanding | null;
  interpreterMode?: DateTurnInterpreterMode;
  semanticSignalDiagnostics?: SemanticSignalDecision[];
  understandingComparison?: UnderstandingComparison | null;
  executionPlan?: DateExecutionPlan | null;
  executionPlanComparison?: ExecutionPlanComparison | null;
  tasteBoard?: TasteBoard | null;
  archives?: ArchivedDatePlan[];
  memory?: DateMemoryContext | null;
  currentPlan?: AIPlannerReply | null;
  goals?: DateTaskObjective[];
  candidatePool?: CandidatePoolSnapshot | null;
  sessionCandidates?: SessionCandidateContext | null;
  observations?: DateObservation[];
  observedAt: string;
  uncertainties?: string[];
  openQuestions?: string[];
}): DateContext {
  const intent = toDateIntent(input.state);
  const records = input.candidatePool?.records ?? [];
  const memory = input.memory ?? null;
  return {
    conversation: [...(input.conversation ?? [])],
    currentUnderstanding: input.currentUnderstanding ?? null,
    shadowUnderstanding: input.shadowUnderstanding ?? null,
    effectiveUnderstanding: input.effectiveUnderstanding ?? input.currentUnderstanding ?? null,
    interpreterMode: input.interpreterMode ?? "off",
    semanticSignalDiagnostics: [...(input.semanticSignalDiagnostics ?? [])],
    understandingComparison: input.understandingComparison ?? null,
    executionPlan: input.executionPlan ?? null,
    executionPlanComparison: input.executionPlanComparison ?? null,
    objective: intent.objective,
    hardConstraints: intent.hardConstraints,
    softPreferences: { ...intent.preferences, vibe: [...intent.preferences.vibe] },
    inferredPreferences: [...intent.inferredPreferences],
    coupleContext: { tasteBoard: input.tasteBoard ?? null, explicitProfile: memory?.explicitProfile ?? null },
    relevantMemories: { collected: memory, archivedPlans: [...(input.archives ?? [])] },
    currentPlan: input.currentPlan ?? null,
    goals: [...(input.goals ?? [])],
    candidates: { records: [...records], eligibleIds: (input.candidatePool?.eligible ?? []).map(dateCandidateKey) },
    sessionCandidates: input.sessionCandidates ?? null,
    sessionFeedback: input.sessionCandidates?.feedback ?? null,
    observations: [...(input.observations ?? []), ...candidateRecordObservations(records, input.observedAt)],
    facts: records.map(({ id, facts, evidence }) => ({ id, facts, evidence })),
    uncertainties: [...(input.uncertainties ?? [])],
    openQuestions: [...(input.openQuestions ?? [])],
  };
}
