import type { DateCourseRow } from "./dateCourse";
import type { PlanningIssueOrigin } from "./planningPolicy";

export type PlanningTransformationStage =
  | "legacy_candidate_filter"
  | "legacy_cuisine_replacement"
  | "legacy_required_place_insertion"
  | "legacy_slot_limits"
  | "legacy_minimum_fill"
  | "legacy_activity_spine"
  | "legacy_route_shape"
  | "legacy_order_and_schedule"
  | "evaluation_candidate_filter"
  | "evaluation_day_optimization"
  | "evaluation_duration_defaults";

type RowSnapshot = Pick<DateCourseRow, "id" | "day_index" | "start_time" | "duration_minutes" | "expected_cost">;
export type PlanningTransformation = {
  stage: PlanningTransformationStage;
  /** Policy that caused the change; a legacy-only code is used where no issue exists yet. */
  reasonCode?: string;
  origin: PlanningIssueOrigin;
  before: RowSnapshot[];
  after: RowSnapshot[];
};

/** Internal diagnostics, with no user text or model-authored explanations.
 * A transformation is not a validation issue and never affects acceptance. */
export function tracePlanningTransformation(stage: PlanningTransformationStage,
  before: readonly DateCourseRow[], after: readonly DateCourseRow[],
  reason?: { code: string; origin?: PlanningIssueOrigin }): PlanningTransformation[] {
  const snapshot = (rows: readonly DateCourseRow[]) => rows.map(row => ({
    id: row.id, day_index: row.day_index, start_time: row.start_time,
    duration_minutes: row.duration_minutes, expected_cost: row.expected_cost,
  }));
  const previous = snapshot(before);
  const next = snapshot(after);
  return JSON.stringify(previous) === JSON.stringify(next) ? []
    : [{ stage, reasonCode: reason?.code, origin: reason?.origin ?? "legacy_heuristic", before: previous, after: next }];
}
