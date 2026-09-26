import type { AIChatStop, AIPlannerReply, AIPlannerState, DateChatTurn } from "@/features/planning/types/plan";
import type { DateContext } from "@/features/ai/dateContext";
import { dateTurnPayloadSchema, validateDateTurnPayload, type DateTurnPayload } from "@/features/ai/dateTurnShadow";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

export type DateTurnInterpreterInput = {
  message: string;
  conversation?: DateChatTurn[];
  currentPlan?: AIPlannerReply | null;
  visiblePlaces?: Array<AIChatStop | string>;
  state: AIPlannerState;
  context?: DateContext | null;
};

/** Only the information needed to interpret this turn crosses the model boundary. */
export function dateTurnPromptContext(input: DateTurnInterpreterInput) {
  const constraints = input.context?.hardConstraints;
  const orderedPlaces = input.currentPlan?.items.length
    ? [...input.currentPlan.items].sort((a, b) => a.dayIndex - b.dayIndex || a.order - b.order)
      .map(item => {
        const place = input.currentPlan?.recommendations.find(candidate => candidate.placeId === item.placeId);
        return { name: item.placeName, category: item.category, activitySlot: place?.activitySlot ?? null };
      })
    : (input.currentPlan?.recommendations ?? []).map(place => ({ name: place.name,
      category: place.category, activitySlot: place.activitySlot ?? null }));
  return {
    latestMessage: input.message.slice(0, 800),
    recentTurns: (input.conversation ?? []).slice(-6).map(turn => ({ role: turn.role, text: turn.text.slice(0, 240) })),
    currentPlan: orderedPlaces.slice(0, 12).map((place, index) => ({
      position: index + 1, ...place,
    })),
    visiblePlaces: (input.visiblePlaces ?? []).slice(0, 12).map((place, index) => ({
      position: index + 1, name: typeof place === "string" ? place : place.name,
      category: typeof place === "string" ? "" : place.meta,
    })),
    currentContext: {
      areas: (constraints?.areas ?? input.state.areas).slice(0, 6),
      date: constraints?.date ?? input.state.dateLabel,
      startTime: constraints?.startTime ?? input.state.startTime,
      endTime: constraints?.endTime ?? input.state.endTime,
      budgetWon: constraints?.budgetWon ?? input.state.budgetWon ?? null,
      requiredPlaces: (constraints?.requiredPlaces ?? input.state.requiredPlaces).slice(0, 8),
      excludedPlaces: (constraints?.excludedPlaces ?? input.state.excludedPlaces).slice(0, 8),
      excludedFoods: (constraints?.excludedFoods ?? input.state.excludedFoods ?? []).slice(0, 8),
      requiredActivities: (constraints?.requiredActivities ?? input.state.activities).slice(0, 8),
    },
  };
}

export async function interpretDateTurnWithOpenAi(input: DateTurnInterpreterInput): Promise<DateTurnPayload | null> {
  if (!isOpenAiConfigured() || !input.message.trim()) return null;
  try {
    const raw = await completeJson<unknown>({
      jsonSchema: { name: "date_turn_understanding_v1", strict: true, schema: dateTurnPayloadSchema },
      maxTokens: 1800, reasoningEffort: "low", timeoutMs: 9000,
      messages: [
        { role: "system", content: [
          "Interpret one Korean couple-date conversation turn. Return JSON matching the supplied schema.",
          "Goals may be multiple in one message. Separate semantic preferences, requested changes, attribute-level feedback, and references.",
          "For semanticPreferences.dimension use only these exact keys: pace, novelty, atmosphere, crowd, noise, activity_level, indoor_outdoor, romantic, exploration, food_focus. Area or location belongs in constraintClaims, never semanticPreferences. '여유롭게' is pace=relaxed; '조용하게' is noise=quiet.",
          "For feedback.attribute use a short attribute key such as aesthetic, noise, crowd, menu, service, price, or overall. Never use phrases such as 'noise level'. Explicit feedback like '너무 시끄러웠어' should also have a provide_feedback goal when appropriate.",
          "The latestMessage is authoritative for what the user said. Recent turns and current plan only disambiguate references.",
          "Do not invent venues, IDs, dates, times, areas, budgets, exclusions, or constraints. proposedId should normally be null; the app verifies references.",
          "constraintClaims are diagnostic guesses only: copy explicit values from latestMessage when certain, otherwise use null or []. Never infer hard facts from preferences.",
          "Keep ambiguous references unresolved and explain uncertainty in ambiguities. Do not choose an exact start time for '저녁쯤'.",
          "Confidence: high 0.85-1 only with direct, clear utterance evidence; medium 0.55-0.84 with reasonable conversational context; low 0-0.54 when multiple meanings or references remain.",
          "Use short evidenceText copied from the user utterance. Use distinct feedback rows for positive aesthetics and negative noise/crowding.",
        ].join(" ") },
        { role: "user", content: JSON.stringify(dateTurnPromptContext(input)) },
      ],
    });
    return validateDateTurnPayload(raw);
  } catch {
    return null;
  }
}
