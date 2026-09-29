/** Only hard issues reject a course. Runtime provenance can strengthen a
 * grounded requirement; discovery's copied/default values cannot. */
export type PlanningIssueSeverity = "hard" | "soft";
export type PlanningIssueOrigin = "explicit_constraint" | "verified_fact" | "inferred_preference" | "legacy_heuristic";
export type PlanningIssueScope = { dayIndex?: number; candidateId?: string; constraint?: string };

export const PLANNING_POLICIES = {
  unknown_candidate: { severity: "hard", origin: "verified_fact", legacyFragment: "검색으로 확인되지" },
  duplicate_place: { severity: "hard", origin: "legacy_heuristic", legacyFragment: "같은 장소 중복" },
  stop_count: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "요청에 맞지 않는 장소 수" },
  explicit_stop_count: { severity: "hard", origin: "explicit_constraint", legacyFragment: "명시한 장소 수 불일치" },
  missing_day: { severity: "hard", origin: "legacy_heuristic", legacyFragment: "일차 누락" },
  sparse_day: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "일차 일정 부족" },
  dense_day: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "일차 장소 과밀" },
  missing_daily_experience: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "여행일 핵심 경험 누락" },
  missing_daily_meal: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "여행일 식사 누락" },
  missing_experience_evidence: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "여행 핵심 장소 근거 부족" },
  festival_date_mismatch: { severity: "hard", origin: "verified_fact", legacyFragment: "축제 날짜 불일치" },
  performance_date_mismatch: { severity: "hard", origin: "verified_fact", legacyFragment: "공연 날짜 불일치" },
  required_place_missing: { severity: "hard", origin: "explicit_constraint", legacyFragment: "유지할 장소 누락" },
  selected_anchor_missing: { severity: "hard", origin: "explicit_constraint", legacyFragment: "선택한 장소 누락" },
  repeated_complex_day: { severity: "hard", origin: "verified_fact", legacyFragment: "같은 복합시설 재방문" },
  confirmed_closed: { severity: "hard", origin: "verified_fact", legacyFragment: "확인된 영업시간과 충돌" },
  excluded_place: { severity: "hard", origin: "explicit_constraint", legacyFragment: "제외 요청한 장소 포함" },
  required_activity_missing: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "요청 활동 누락" },
  cuisine_mismatch: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "음식 종류 불일치" },
  excluded_food: { severity: "hard", origin: "explicit_constraint", legacyFragment: "제외 음식이 포함된 장소" },
  allergy_unverified: { severity: "hard", origin: "explicit_constraint", legacyFragment: "알레르기 안전성 미확인" },
  budget_exceeded: { severity: "hard", origin: "explicit_constraint", legacyFragment: "예산 초과" },
  required_order_mismatch: { severity: "hard", origin: "explicit_constraint", legacyFragment: "유지할 순서 불일치" },
  performance_time_unverified: { severity: "hard", origin: "explicit_constraint", legacyFragment: "방문일 공연 회차 미확인" },
  required_opening_unverified: { severity: "hard", origin: "explicit_constraint", legacyFragment: "요청한 영업시간 확인 불가" },
  actual_route_limit: { severity: "hard", origin: "verified_fact", legacyFragment: "실제 보행 경로가 이동 한도를 초과함" },
  actual_route_schedule_conflict: { severity: "hard", origin: "verified_fact", legacyFragment: "실제 보행 경로와 지정한 시간의 충돌" },
  schedule_infeasible: { severity: "hard", origin: "explicit_constraint", legacyFragment: "지정한 시간" },
  long_hop: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "이동 부담" },
  walking_burden: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "도보 부담" },
  outside_area: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "기준 동네에서 먼 장소" },
  repeated_cafe: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "카페 중복" },
  repeated_meal: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "식사 중복" },
  repeated_added_experience: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "추가 경험 중복" },
  cafe_space_evidence_missing: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "카페 공간 근거 부족" },
  generic_chain: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "매력 근거 없는 프랜차이즈" },
  low_variety: { severity: "soft", origin: "legacy_heuristic", legacyFragment: "경험이 한 종류로 반복" },
} as const;
export type PlanningIssueCode = keyof typeof PLANNING_POLICIES | "legacy_unclassified";
export type PlanningIssue = {
  code: PlanningIssueCode;
  severity: PlanningIssueSeverity;
  origin: PlanningIssueOrigin;
  scope: PlanningIssueScope;
  message: string;
};

export type PlanningQualitySignal = { dimension: string; value: number };

export function planningIssue(code: keyof typeof PLANNING_POLICIES, message: string,
  scope: PlanningIssueScope = {}, effectiveSeverity?: PlanningIssueSeverity,
  effectiveOrigin?: PlanningIssueOrigin): PlanningIssue {
  const { severity, origin } = PLANNING_POLICIES[code];
  return { code, severity: effectiveSeverity ?? severity, origin: effectiveOrigin ?? origin, scope, message };
}

/** Compatibility boundary only. New producers supply codes directly; display
 * text is never interpreted by the structured evaluation path. Unknown legacy
 * text stays non-hard, matching the former hardCourseProblems filter. */
export function legacyPlanningIssue(message: string): PlanningIssue {
  const code = (Object.keys(PLANNING_POLICIES) as Array<keyof typeof PLANNING_POLICIES>)
    .sort((a, b) => PLANNING_POLICIES[b].legacyFragment.length - PLANNING_POLICIES[a].legacyFragment.length)
    .find(code => message.includes(PLANNING_POLICIES[code].legacyFragment));
  const day = message.match(/^(\d+)일차/);
  const scope = day ? { dayIndex: Number(day[1]) - 1 } : {};
  return code ? planningIssue(code, message, scope) : {
    code: "legacy_unclassified", severity: "soft", origin: "legacy_heuristic", scope, message,
  };
}

export function partitionPlanningIssues(issues: readonly PlanningIssue[]) {
  return {
    hardViolations: issues.filter(issue => issue.severity === "hard"),
    softWarnings: issues.filter(issue => issue.severity === "soft"),
  };
}

/** Proposal, fallback, and verifier use the same hard-only acceptance rule. */
export function blocksCourse(issues: readonly PlanningIssue[], path: "model_proposal" | "deterministic_seed") {
  void path;
  return issues.some(issue => issue.severity === "hard");
}
