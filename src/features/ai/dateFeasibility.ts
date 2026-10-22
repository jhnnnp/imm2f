import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { assumedTimeWindow, courseSize } from "./dateBrief";
import { candidateActivitySlot, dateCandidateKey, performanceVisitDate } from "./dateCourse";
import { tripLocalWindows } from "./planningSupport";
import { clockMinutes } from "./schedule";
import { sameVenueBranch } from "./venueIdentity";

export type DateFeasibilityFailure = {
  passed: false;
  reason: "missing_selected_places" | "selected_stays_exceed_time" | "performance_visit_date_missing" | "duplicate_selected_place";
  message: string;
  minimumStayMinutes?: number;
  availableMinutes?: number;
};

/** Reject only provably impossible selections before paid generation. Distances,
 * unknown costs/hours and preferred durations cannot prove impossibility. */
export function selectedDateFeasibility(candidates: DiscoverCandidate[], anchorIds: string[],
  state: AIPlannerState): DateFeasibilityFailure | null {
  if (!anchorIds.length) return null;
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  if (anchorIds.some(id => !byId.has(id))) return { passed: false, reason: "missing_selected_places",
    message: "선택한 장소를 확인된 후보에서 모두 찾지 못했어요. 장소 선택을 새로 확인해 주세요." };
  const selected = [...new Set(anchorIds)].map(id => byId.get(id)!);
  if (selected.some((venue, index) => selected.slice(index + 1).some(other => sameVenueBranch(venue, other))))
    return { passed: false, reason: "duplicate_selected_place",
      message: "선택한 후보 중 서로 다른 검색 출처의 같은 장소가 있어요. 같은 지점은 하나만 골라 주세요." };
  if (!performanceVisitDate(state) && selected.some(venue => candidateActivitySlot(venue) === "performance" && venue.performanceEvent))
    return { passed: false, reason: "performance_visit_date_missing",
      message: "공연 방문 날짜를 먼저 정해야 회차를 확인할 수 있어요. 방문 날짜를 알려주시거나 공연 장소를 바꿔 주세요." };
  const { days } = courseSize(state);
  const window = assumedTimeWindow(state);
  const local = tripLocalWindows(state.userRequests ?? [], days);
  let availableMinutes = 0;
  for (let day = 0; day < days; day++) {
    const start = local[day]?.start ?? window.startTime;
    const end = local[day]?.end ?? window.endTime;
    if (![start, end].every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return null;
    let available = clockMinutes(end) - clockMinutes(start);
    // Crossing midnight is not represented as a same-day itinerary. Let the
    // schedule verifier explain this rather than guessing an available window.
    if (available <= 0) return null;
    availableMinutes += available;
  }
  const minimumStayMinutes = selected.reduce((sum, venue) => {
    const duration = venue.performanceEvent?.durationMinutes;
    return sum + (candidateActivitySlot(venue) === "performance" && Number.isSafeInteger(duration)
      && duration! >= 15 && duration! <= 720 ? duration! : 30);
  }, 0);
  if (minimumStayMinutes > availableMinutes) return { passed: false, reason: "selected_stays_exceed_time",
    minimumStayMinutes, availableMinutes,
    message: `선택한 ${selected.length}곳은 확인된 공연 시간과 장소별 최소 체류 시간을 합쳐도 ${minimumStayMinutes}분이 필요해요. 알려주신 일정의 ${availableMinutes}분을 초과해 이동까지 담을 수 없어요. 시간이나 여행 일수를 늘리거나 이번 일정에 넣을 장소를 조정해 주세요.` };
  return null;
}
