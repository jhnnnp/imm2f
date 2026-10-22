import { applyTasteFallback } from "@/features/taste/compare";
import type { TasteDateSeed } from "@/features/taste/types";
import type { AIPlannerState } from "@/features/planning/types/plan";

/** Saved taste informs ranking; a preferred neighborhood is not this trip's destination. */
export function applyPlannerTasteHints(state: AIPlannerState, seed: TasteDateSeed): AIPlannerState {
  const explicitPace = [...(state.userRequests ?? []), ...state.conversationNotes]
    .some(request => /여유|느긋|천천|알차|빡빡|적당|균형|보통|많이\s*(?:돌|둘러|가)/.test(request));
  return { ...applyTasteFallback(state, seed), ...(explicitPace ? { pace: state.pace } : {}),
    areas: state.areas, regions: state.regions, region: state.region };
}
