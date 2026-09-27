import { evaluateCourse, feasibleCourseSeeds } from "../src/features/ai/courseDesign";
import { blocksCourse } from "../src/features/ai/planningPolicy";
import { PLANNING_SCENARIOS } from "../src/features/ai/planningPolicy.scenarios";

const rows = PLANNING_SCENARIOS.map(scenario => {
  const evaluation = evaluateCourse({ theme: "fixture", rows: scenario.rows }, scenario.candidates,
    scenario.state, new Set());
  const seeds = feasibleCourseSeeds(scenario.candidates, scenario.state, new Set());
  return {
    id: scenario.id, expected: scenario.expected,
    accepted: !blocksCourse(evaluation.issues, "model_proposal"),
    hardIssues: evaluation.issues.filter(issue => issue.severity === "hard").map(issue => issue.code),
    softIssues: evaluation.issues.filter(issue => issue.severity === "soft").map(issue => issue.code),
    stopCount: evaluation.rows.length, fallbackUsed: seeds.length > 0,
    transformationCount: evaluation.transformations.length,
  };
});
const positives = rows.filter(row => row.expected === "accepted");
const negatives = rows.filter(row => row.expected === "blocked");
const summary = {
  total: rows.length,
  generationSuccessRate: positives.filter(row => row.accepted).length / positives.length,
  hardViolationCount: rows.reduce((sum, row) => sum + row.hardIssues.length, 0),
  softIssueCount: rows.reduce((sum, row) => sum + row.softIssues.length, 0),
  unnecessaryRejectionCount: positives.filter(row => !row.accepted).length,
  unsafeAcceptanceCount: negatives.filter(row => row.accepted).length,
  simulatedFallbackUseRateWhenModelUnavailable: rows.filter(row => row.fallbackUsed).length / rows.length,
  transformationCount: rows.reduce((sum, row) => sum + row.transformationCount, 0),
};
process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);
