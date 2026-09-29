import type { AIPlanCondition, AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { DateCourseRow } from "./dateCourse";
import { assignStartTimes } from "./dateCourse";
import type { CourseEvaluation } from "./courseDesign";
import type { FootLeg, FootRoute } from "@/lib/routing/footRoute";
import { legacyPlanningIssue, partitionPlanningIssues, planningIssue, type PlanningIssue, type PlanningQualitySignal } from "./planningPolicy";

function clockMinutes(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

/** A real walking leg must fit between the two reserved stops. */
export function routeLegsFitSchedule(rows: DateCourseRow[], legs: FootLeg[]) {
  for (let index = 1; index < rows.length; index++) {
    if (rows[index].day_index !== rows[index - 1].day_index) continue;
    const previous = rows[index - 1];
    const next = rows[index];
    const previousClock = clockMinutes(previous.start_time);
    const nextClock = clockMinutes(next.start_time);
    if (previousClock == null || nextClock == null || !legs[index - 1]) return false;
    const available = nextClock - previousClock - Number(previous.duration_minutes ?? 0);
    if (available * 60 < legs[index - 1].seconds) return false;
  }
  return true;
}

export type DateVerification = { passed: boolean; issues: string[]; warnings: string[];
  hardIssues: PlanningIssue[]; softIssues: PlanningIssue[]; qualitySignals: PlanningQualitySignal[];
  routeVerified: boolean };

/** Final deterministic critic; the model cannot waive a hard issue. */
export function verifyDateItinerary(input: {
  course: CourseEvaluation;
  candidates: DiscoverCandidate[];
  state: AIPlannerState;
  condition: AIPlanCondition;
  route: FootRoute | null;
}): DateVerification {
  const reported = input.course.issues ?? input.course.problems.map(legacyPlanningIssue);
  const issues: PlanningIssue[] = [...reported];
  if (input.route) {
    const limit = input.state.walkingPreference === "short" ? 1100 : 3000;
    const dailyLimit = input.state.walkingPreference === "short" ? 2500 : 6500;
    const distanceByDay = new Map<number, number>();
    for (let index = 0; index < input.course.rows.length - 1; index++) {
      const previous = input.course.rows[index];
      const next = input.course.rows[index + 1];
      if (previous.day_index !== next.day_index) continue;
      const leg = input.route.legs[index];
      if (!leg) continue;
      const day = next.day_index ?? 0;
      distanceByDay.set(day, (distanceByDay.get(day) ?? 0) + leg.meters);
      if (leg.meters > limit) issues.push(planningIssue("actual_route_limit",
        "실제 보행 경로가 이동 한도를 초과함", { dayIndex: day, candidateId: next.id }));
    }
    for (const [day, meters] of distanceByDay) if (meters > dailyLimit)
      issues.push(planningIssue("actual_route_limit", "실제 보행 경로가 이동 한도를 초과함", { dayIndex: day }));
    if (input.condition.timeSpecified) {
      const schedule = assignStartTimes(input.course.rows, input.candidates, input.state, input.condition.startTime);
      if (schedule.length !== input.course.rows.length || !routeLegsFitSchedule(schedule, input.route.legs)) {
        const conflict = schedule.findIndex((row, index) => index > 0
          && row.day_index === schedule[index - 1].day_index
          && (() => {
            const before = schedule[index - 1];
            const previousClock = clockMinutes(before.start_time);
            const nextClock = clockMinutes(row.start_time);
            return previousClock == null || nextClock == null || !input.route!.legs[index - 1]
              || (nextClock - previousClock - Number(before.duration_minutes ?? 0)) * 60
                < input.route!.legs[index - 1].seconds;
          })());
        issues.push(planningIssue("actual_route_schedule_conflict", "실제 보행 경로와 지정한 시간의 충돌",
          conflict >= 0 ? { dayIndex: schedule[conflict].day_index ?? 0,
            candidateId: schedule[conflict].id } : {}));
      }
    }
  }
  const partitioned = partitionPlanningIssues(issues);
  return { passed: partitioned.hardViolations.length === 0,
    issues: [...new Set(partitioned.hardViolations.map(issue => issue.message))],
    warnings: [...new Set(partitioned.softWarnings.map(issue => issue.message))],
    hardIssues: partitioned.hardViolations, softIssues: partitioned.softWarnings,
    qualitySignals: input.course.qualitySignals ?? [], routeVerified: Boolean(input.route) };
}
