import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DateContext } from "@/features/ai/dateContext";
import { buildExperiencePlanInput, compareExperiencePlanToLegacy,
  experiencePlanSchema, validateExperiencePlan, type ExperiencePlan,
  type ExperiencePlanComparison } from "@/features/ai/experiencePlan";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

/** Opt-in read model. An unavailable or invalid proposal leaves the legacy path untouched. */
export function isExperiencePlanShadowEnabled() {
  return process.env.DATE_EXPERIENCE_PLAN_SHADOW === "true"
    || process.env.DATE_RESEARCH_PLAN_MODE === "shadow"
    || process.env.DATE_RESEARCH_PLAN_MODE === "active";
}

export async function observeExperiencePlan(input: { message: string; state: AIPlannerState;
  context: Pick<DateContext, "hardConstraints" | "effectiveUnderstanding" | "sessionFeedback">;
  explorationEnabled?: boolean },
  complete: typeof completeJson = completeJson): Promise<{ plan: ExperiencePlan;
    comparison: ExperiencePlanComparison } | null> {
  if (!(isExperiencePlanShadowEnabled() || input.explorationEnabled) || !isOpenAiConfigured() || !input.message.trim()) return null;
  try {
    const prompt = buildExperiencePlanInput(input.message, input.state, input.context);
    const { activitySignals, ...boundedInput } = prompt;
    const explicitRequiredActivities = activitySignals.filter(item => item.explicit).map(item => item.activity);
    const optionalActivitySignals = activitySignals.filter(item => !item.explicit).map(item => item.activity);
    const raw = await complete<unknown>({
      jsonSchema: { name: "date_experience_plan_v1", strict: true, schema: experiencePlanSchema },
      maxTokens: 2200, reasoningEffort: "low", timeoutMs: 10000,
      messages: [
        { role: "system", content: [
          "Design a Korean date/trip experience plan BEFORE venue research. Return only the strict JSON schema.",
          "Do not choose venue/candidate IDs, business names or individual landmarks as destinations. geographicFocus MUST be an established, provider-searchable district or neighborhood within the requested destination (for example 해운대구, 기장군, 익선동), never an invented poetic label such as '부산 해안가' or '문화지구'. If unsure, repeat the user's known area. visitContext must describe a generic visit cluster, not a named beach, tower, market or mall.",
          "Plan the whole trip first. Give each day a distinct purpose and geographic strategy; do not repeat one complex as separate day destinations without a clear reason.",
          "Use density according to actual available time, arrival/departure, pace and experience; never derive it from a fixed stop count. A late arrival or early departure should usually be light.",
          "A meal, cafe, rest or shopping may support one primary experience within the same block; they are not always separate destinations. A cafe-only request needs no meal or walk block.",
          `requiredElements MUST equal exactly ${JSON.stringify(explicitRequiredActivities)}. Never add an inferred or default activity to requiredElements. optionalElements may use only optionalActivitySignals and must not repeat requiredElements.`,
          `qualitativeNeeds MUST equal exactly ${JSON.stringify(prompt.qualitativeNeeds)}. If it is empty, every block qualitativeNeeds MUST also be empty. Otherwise distribute only these supplied qualities to relevant blocks. Never invent a quality or mark it explicit_user unless supplied.`,
          "Represent unknown arrival, departure, venue availability and other uncertainty honestly. This plan is conceptual, not an itinerary or fact claim.",
        ].join(" ") },
        { role: "user", content: JSON.stringify({ ...boundedInput,
          explicitRequiredActivities, optionalActivitySignals }) },
      ],
    });
    const plan = validateExperiencePlan(raw, prompt);
    return plan ? { plan, comparison: compareExperiencePlanToLegacy(plan, input.state, [], input.message) } : null;
  } catch {
    return null;
  }
}
