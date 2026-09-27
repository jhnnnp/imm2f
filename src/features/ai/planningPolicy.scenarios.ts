import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { dateCandidateKey, type DateCourseRow } from "./dateCourse";

export type PlanningScenario = {
  id: string;
  state: AIPlannerState;
  candidates: DiscoverCandidate[];
  rows: DateCourseRow[];
  expected: "accepted" | "blocked";
};

const base = () => ({ ...withAreas(emptyDateBrief(), ["부산"]), dateLabel: "2026-10-06" });
const venue = (id: string, category: DiscoverCandidate["category"], offset: number,
  extra: Partial<DiscoverCandidate> = {}): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name: id, category,
  categoryLabel: category, district: "부산", address: "부산", roadAddress: "", phone: "",
  mapUrl: "", coordinates: [129.04 + offset * 0.001, 35.1],
  ...extra,
});
const items = [
  venue("해변", "tourist", 0), venue("식당A", "restaurant", 1, { expectedCostTwo: 25000 }),
  venue("정원카페", "cafe", 2), venue("전망대", "tourist", 3),
  venue("식당B", "restaurant", 4, { expectedCostTwo: 30000 }),
  venue("숲길", "nature", 5), venue("식당C", "restaurant", 6, { expectedCostTwo: 20000 }),
  venue("카페B", "cafe", 7),
];
const scenario = (id: string, patch: Partial<AIPlannerState>, selected: Array<[number, number]>,
  expected: PlanningScenario["expected"] = "accepted", candidates = items): PlanningScenario => ({
  id, state: { ...base(), ...patch }, candidates,
  rows: selected.map(([index, day_index]) => ({ id: dateCandidateKey(candidates[index]), day_index })),
  expected,
});
const threeDay = { stayKind: "overnight" as const, nights: 2 };

/** Fixed provider identities and coordinates; no API or LLM calls. */
export const PLANNING_SCENARIOS: PlanningScenario[] = [
  scenario("A_busan_three_days", threeDay, [[0, 0], [1, 0], [3, 1], [4, 1], [5, 1], [7, 2], [6, 2]]),
  scenario("B_late_arrival", { ...threeDay, userRequests: ["첫날 오후 7시 도착"] },
    [[0, 0], [3, 1], [4, 1], [5, 1], [7, 2]]),
  scenario("C_early_departure", { ...threeDay, userRequests: ["마지막 날 오후 2시 출발"] },
    [[0, 0], [1, 0], [3, 1], [4, 1], [7, 2]]),
  scenario("D_restful_trip", { ...threeDay, userRequests: ["휴양 위주로 여유롭게"] },
    [[0, 0], [3, 1], [7, 2]]),
  scenario("E_cafe_tour", { activities: ["cafe"], userRequests: ["카페 투어 중심"] },
    [[2, 0], [7, 0]], "accepted"),
  scenario("F_short_evening", { timeWindow: "evening", startTime: "19:00", endTime: "21:00" },
    [[1, 0]]),
  scenario("G_active_date", { activities: ["walk"], userRequests: ["활동적인 데이트"] },
    [[0, 0], [5, 0]]),
  scenario("H_slim_three_days", { ...threeDay, userRequests: ["2박3일 여유롭게"] },
    [[0, 0], [3, 1], [5, 2]]),
  scenario("S_budget", { budgetWon: 10000 }, [[1, 0], [2, 0]], "blocked"),
  scenario("S_excluded_food", { excludedFoods: ["해산물"] }, [[0, 0], [1, 0]], "blocked",
    [items[0], { ...items[1], dishes: "해산물 파스타" }]),
  scenario("S_required_place", { requiredPlaces: ["부산역"] }, [[0, 0], [1, 0]], "blocked"),
  scenario("S_excluded_place", { excludedPlaces: ["해변"] }, [[0, 0], [1, 0]], "blocked"),
  scenario("S_explicit_time", { startTime: "20:00", endTime: "20:30" }, [[0, 0], [1, 0]], "blocked"),
  scenario("S_invalid_candidate", {}, [[0, 0], [1, 0]], "blocked"),
  scenario("S_required_opening", { userRequests: ["밤 10시에 확실히 열려 있는 곳만 추천해줘"] },
    [[0, 0], [1, 0]], "blocked"),
].map(item => item.id === "S_invalid_candidate"
  ? { ...item, rows: [{ id: "invented:venue", day_index: 0 }, item.rows[1]] }
  : item);
