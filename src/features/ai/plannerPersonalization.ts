import { applyTasteFallback } from "@/features/taste/compare";
import type { TasteDateSeed } from "@/features/taste/types";
import type { AIPlannerState } from "@/features/planning/types/plan";

/** Saved taste informs ranking; a preferred neighborhood is not this trip's destination. */
export function applyPlannerTasteHints(state: AIPlannerState, seed: TasteDateSeed): AIPlannerState {
  return { ...applyTasteFallback(state, seed), areas: state.areas,
    regions: state.regions, region: state.region };
}
