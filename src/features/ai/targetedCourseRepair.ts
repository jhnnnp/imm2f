import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import { candidateActivitySlot, dateCandidateKey, type DateCourseRow } from "./dateCourse";
import { blocksCourse } from "./planningPolicy";
import { evaluateCourse, type CourseConstraints, type CourseEvaluation } from "./courseDesign";

const key = (rows: DateCourseRow[]) => rows.map(row => `${row.day_index}:${row.id}:${row.duration_minutes}`).join("|");

/** The model may return a full itinerary, but it cannot quietly rewrite days
 * outside the verifier's affected scope. */
export function preservesUnchangedDays(before: DateCourseRow[], after: DateCourseRow[], affectedDays: ReadonlySet<number>) {
  const locked = (rows: DateCourseRow[]) => rows.filter(row => !affectedDays.has(row.day_index ?? 0));
  return key(locked(before)) === key(locked(after));
}

export function affectedRepairDays(course: CourseEvaluation, constraints: CourseConstraints = {}): Set<number> {
  const days = new Set(course.hardIssues.flatMap(issue => issue.scope.dayIndex == null ? [] : [issue.scope.dayIndex]));
  const anchors = new Set(constraints.anchorIds ?? []);
  for (const issue of course.hardIssues) {
    if (issue.code !== "repeated_complex_day" || !issue.scope.candidateId
      || !anchors.has(issue.scope.candidateId)) continue;
    const selected = new Set(course.rows.map(row => row.id));
    const relation = constraints.candidateGraph?.relations.find(item =>
      item.complexKey === issue.scope.constraint && item.candidateIds.includes(issue.scope.candidateId!)
      && item.candidateIds.every(id => selected.has(id)));
    if (!relation) continue;
    for (const row of course.rows) if (row.id && relation.candidateIds.includes(row.id))
      days.add(row.day_index ?? 0);
  }
  return days;
}

/** A bounded local repair for a closed stop or a repeat visit to one complex.
 * Replaces one non-anchor on the affected day; all other rows stay intact. */
export function repairAffectedStop(course: CourseEvaluation, candidates: DiscoverCandidate[],
  state: AIPlannerState, saved: Set<string>, constraints: CourseConstraints): CourseEvaluation | null {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const anchors = new Set(constraints.anchorIds ?? []);
  const reparable = course.hardIssues.filter(issue =>
    (issue.code === "repeated_complex_day" || issue.code === "confirmed_closed")
      && issue.scope.dayIndex != null && issue.scope.candidateId && !anchors.has(issue.scope.candidateId));
  const attempts: CourseEvaluation[] = [];
  for (const issue of reparable.slice(0, 2)) {
    const index = course.rows.findIndex(row => row.id === issue.scope.candidateId
      && row.day_index === issue.scope.dayIndex);
    if (index < 0) continue;
    const original = byId.get(course.rows[index].id!);
    if (!original) continue;
    const used = new Set(course.rows.map(row => row.id));
    const day = issue.scope.dayIndex!;
    const neighbors = course.rows.filter((row, rowIndex) => rowIndex !== index && row.day_index === day)
      .map(row => byId.get(row.id!)).filter((value): value is DiscoverCandidate => Boolean(value));
    const alternatives = candidates.filter(candidate => !used.has(dateCandidateKey(candidate))
      && candidateActivitySlot(candidate) === candidateActivitySlot(original))
      .sort((a, b) => {
        const cost = (candidate: DiscoverCandidate) => neighbors.reduce((sum, neighbor) =>
          sum + distanceMeters(candidate.coordinates, neighbor.coordinates), 0);
        return cost(a) - cost(b);
      }).slice(0, 12);
    for (const alternative of alternatives) {
      const rows = course.rows.map((row, rowIndex) => rowIndex === index
        ? { ...row, id: dateCandidateKey(alternative) } : row);
      const evaluated = evaluateCourse({ theme: course.theme, rows }, candidates, state, saved, constraints);
      if (!blocksCourse(evaluated.issues, "deterministic_seed")
        && preservesUnchangedDays(course.rows, evaluated.rows, new Set([day]))) attempts.push(evaluated);
    }
  }
  return attempts.sort((a, b) => b.score - a.score)[0] ?? null;
}
