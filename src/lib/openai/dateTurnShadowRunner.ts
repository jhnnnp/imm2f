import type { DateObservation } from "@/features/ai/dateObservation";
import type { DateTurnUnderstanding } from "@/features/ai/dateTurnUnderstanding";
import { buildEffectiveDateTurnUnderstanding, type EffectiveUnderstandingResult } from "@/features/ai/dateTurnAssist";
import {
  compareDateTurnUnderstanding, mergeDateTurnUnderstanding, normalizeDateTurnPayload,
  type DateTurnPayload, type UnderstandingComparison,
} from "@/features/ai/dateTurnShadow";
import { interpretDateTurnWithOpenAi, type DateTurnInterpreterInput } from "./dateTurnInterpreter";

export type DateTurnInterpreterMode = "off" | "shadow" | "assist";

/** The older boolean flag remains a shadow-mode alias. The explicit mode wins. */
export function getDateTurnInterpreterMode(): DateTurnInterpreterMode {
  const configured = process.env.DATE_TURN_INTERPRETER_MODE?.trim().toLowerCase();
  if (configured === "off" || configured === "shadow" || configured === "assist") return configured;
  if (configured) return "off";
  return process.env.DATE_TURN_INTERPRETER_SHADOW === "true" ? "shadow" : "off";
}

export function isDateTurnShadowEnabled() {
  return getDateTurnInterpreterMode() !== "off";
}

export type DateTurnShadowResult = {
  mode: Exclude<DateTurnInterpreterMode, "off">;
  llmUnderstanding: DateTurnUnderstanding;
  shadowUnderstanding: DateTurnUnderstanding;
  effectiveUnderstanding: DateTurnUnderstanding;
  comparison: UnderstandingComparison;
  observation: DateObservation;
  observations: DateObservation[];
  assist: EffectiveUnderstandingResult | null;
};

/** Runs only when opted in. ASSIST may supply approved soft hints to course proposal; legacy execution remains authoritative. */
export async function runDateTurnShadow(input: DateTurnInterpreterInput & {
  legacyUnderstanding: DateTurnUnderstanding;
}, interpret: (input: DateTurnInterpreterInput) => Promise<DateTurnPayload | null> = interpretDateTurnWithOpenAi): Promise<DateTurnShadowResult | null> {
  const mode = getDateTurnInterpreterMode();
  if (mode === "off") return null;
  try {
    const payload = await interpret(input);
    if (!payload) return null;
    const llmUnderstanding = normalizeDateTurnPayload(payload, {
      message: input.message, currentPlan: input.currentPlan,
      visiblePlaces: input.visiblePlaces, legacy: input.legacyUnderstanding,
    });
    const shadowUnderstanding = mergeDateTurnUnderstanding(input.legacyUnderstanding, llmUnderstanding);
    const comparison = compareDateTurnUnderstanding(input.legacyUnderstanding, llmUnderstanding,
      payload.constraintClaims, payload.references);
    const assist = mode === "assist" ? buildEffectiveDateTurnUnderstanding({
      legacy: input.legacyUnderstanding, llm: llmUnderstanding,
      hardConstraints: input.context?.hardConstraints ?? {
        areas: input.state.areas, date: input.state.dateLabel, startTime: input.state.startTime,
        endTime: input.state.endTime, budgetWon: input.state.budgetWon ?? null,
        requiredPlaces: input.state.requiredPlaces, excludedPlaces: input.state.excludedPlaces,
        excludedFoods: input.state.excludedFoods ?? [], requiredActivities: input.state.activities,
      },
      currentPlan: input.currentPlan, visiblePlaces: input.visiblePlaces,
    }) : null;
    const timestamp = new Date().toISOString();
    const observation: DateObservation = { type: "understanding_comparison", source: "date_turn_shadow",
      data: {
        legacyGoals: [...new Set(input.legacyUnderstanding.goals.map(goal => goal.type))],
        llmGoals: [...new Set(llmUnderstanding.goals.map(goal => goal.type))],
        unresolvedReferences: {
          legacy: input.legacyUnderstanding.references.filter(reference => reference.kind === "unresolved").length,
          llm: llmUnderstanding.references.filter(reference => reference.kind === "unresolved").length,
        },
        ambiguityCount: comparison.ambiguities,
        constraintConflictCount: comparison.constraintConflicts.length,
        invalidReferenceProposalCount: comparison.invalidReferenceProposals,
        goalAgreement: comparison.goalAgreement,
      }, timestamp };
    const observations: DateObservation[] = [observation,
      ...(assist?.semanticSignals ?? []).map(signal => ({
        type: "semantic_signal" as const, source: "date_turn_assist" as const,
        data: signal, timestamp,
      }))];
    return { mode, llmUnderstanding, shadowUnderstanding,
      effectiveUnderstanding: assist?.effectiveUnderstanding ?? input.legacyUnderstanding,
      comparison, observation, observations, assist };
  } catch {
    return null;
  }
}
