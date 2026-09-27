import type { AIPlannerState } from "@/features/planning/types/plan";
import { courseSize } from "./dateBrief";
import { legacyPlanningIssue } from "./planningPolicy";

/** A small compatibility adapter for the existing string-only design result.
 * New proposal rejection uses typed hard issues; this maps its display strings
 * back to codes until the internal design result can carry codes directly. */
export function planningFailureMessage(state: AIPlannerState, rejectionReasons: string[] = []) {
  const codes = new Set(rejectionReasons.map(reason => legacyPlanningIssue(reason).code));
  if (codes.has("allergy_unverified"))
    return "음식 알레르기 안전성을 확인할 자료가 없어 식당을 포함한 코스를 확정하지 않았어요. 이용 가능한 식당을 알려주시면 그 장소를 기준으로 이어서 짜드릴게요.";
  if (codes.has("required_opening_unverified"))
    return "요청하신 영업시간을 장소별로 확인하지 못했어요. 운영시간이 확인된 장소로 다시 찾거나 시간 조건을 조정해 주세요.";
  if (codes.has("schedule_infeasible") || codes.has("actual_route_schedule_conflict"))
    return "알려주신 시간 안에 이동과 체류를 마치기 어려워요. 시간 범위를 넓히거나 필수 장소를 조정해 주세요.";
  if (codes.has("budget_exceeded"))
    return "확인된 비용이 예산을 초과했어요. 예산이나 필수 장소를 조정해 주세요.";
  if (codes.has("required_place_missing"))
    return "지정하신 필수 장소를 확인된 후보에 모두 포함하지 못했어요. 장소 이름이나 위치를 확인해 주세요.";
  if (codes.has("excluded_place") || codes.has("excluded_food"))
    return "제외 조건과 맞지 않는 장소가 포함되어 코스를 확정하지 않았어요. 다른 후보를 더 찾거나 조건을 조정해 주세요.";
  const days = courseSize(state).days;
  const span = days > 1 ? `${days - 1}박${days}일 ` : "";
  if (state.requiredPlaces.length)
    return `지정하신 장소를 포함한 ${span}코스의 검증을 통과하지 못했어요. 이미 알려주신 장소를 기준으로 다른 후보와 동선을 다시 확인해 주세요.`;
  return `${span}코스에 필요한 장소와 동선을 충분히 검증하지 못했어요. 탐색할 지역이나 시간을 조정해 주세요.`;
}
