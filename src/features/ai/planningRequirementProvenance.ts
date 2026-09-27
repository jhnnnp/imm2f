import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import { extractActivitiesFromText, extractCuisine } from "./dateBrief";
import type { PlanningIssueOrigin } from "./planningPolicy";

export type ActivityRequirement = { activity: DateActivityId; origin: PlanningIssueOrigin; explicit: boolean };
export type CuisineRequirement = { cuisine: AIPlannerState["cuisine"]; origin: PlanningIssueOrigin; explicit: boolean };

const questionOrRejection = /\?|어때|좋을까|싫|별로|말고|제외|빼\s*줘|안\s*먹|못\s*먹/;
const userClauses = (state: AIPlannerState) => (state.userRequests ?? [])
  .flatMap(message => message.match(/[^,.!?]+[,.!?]?/g) ?? []);

/** Discovery may copy state.activities, so its requiredActivities label alone
 * cannot establish user authority. The intake choice and user-authored turns can. */
export function resolveRequiredActivities(state: AIPlannerState): ActivityRequirement[] {
  const requested = state.discovery?.requiredActivities ?? state.activities;
  const latestRejected = (state.userRequests?.at(-1) ?? "").split(/[,，。.\n]/)
    .filter(clause => /싫|별로|제외|빼\s*줘|안\s*먹|못\s*먹/.test(clause))
    .flatMap(extractActivitiesFromText);
  return [...new Set(requested)].map(activity => {
    const fromIntake = state.explicitPlanningSelections?.activities?.includes(activity) && !latestRejected.includes(activity);
    const fromTurn = !latestRejected.includes(activity) && userClauses(state).some(clause => !questionOrRejection.test(clause)
      && extractActivitiesFromText(clause).includes(activity));
    const origin: PlanningIssueOrigin = fromIntake || fromTurn ? "explicit_constraint"
      : state.memorySuggestions?.activities.includes(activity) ? "inferred_preference" : "legacy_heuristic";
    return { activity, origin, explicit: origin === "explicit_constraint" };
  });
}

/** State cuisine can be inherited or inferred. Only a matching direct intake
 * choice or grounded user turn makes a mismatch blocking. */
export function resolveCuisineRequirement(state: AIPlannerState): CuisineRequirement {
  const cuisine = state.cuisine;
  if (!cuisine || cuisine === "any") return { cuisine, origin: "legacy_heuristic", explicit: false };
  const fromIntake = state.explicitPlanningSelections?.cuisine === cuisine;
  const fromTurn = userClauses(state).some(clause => !questionOrRejection.test(clause)
    && extractCuisine(clause) === cuisine
    && (/(?:먹|맛집|추천|원|해\s*줘|넣|가고|싶|위주|중심)/.test(clause)
      || clause.replace(/\s/g, "") === cuisine));
  const origin: PlanningIssueOrigin = fromIntake || fromTurn ? "explicit_constraint"
    : state.memorySuggestions?.cuisine === cuisine ? "inferred_preference" : "legacy_heuristic";
  return { cuisine, origin, explicit: origin === "explicit_constraint" };
}
