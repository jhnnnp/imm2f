import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import { courseSize, isExclusiveCrawl, isTravelPlan, matchesActivity, matchesCuisine, matchesTerm, selectedAreas } from "./dateBrief";
import { candidateActivitySlot, dateCandidateKey, defaultDuration, assignStartTimes, type DateCourseRow } from "./dateCourse";

export type CourseProposal = { theme: string; rows: DateCourseRow[] };
export type CourseEvaluation = CourseProposal & { score: number; meters: number; longestHop: number; evidenceCount: number; problems: string[] };
const finite = (n: unknown, fallback: number) => typeof n === "number" && Number.isFinite(n) ? n : fallback;
const compact = (text: string) => text.replace(/\s/g, "").toLowerCase();
const CHAIN_CAFE = /할리스|스타벅스|투썸플레이스|이디야|엔제리너스|커피빈|폴바셋|탐앤탐스|카페베네|메가\s*MGC|메가커피|컴포즈커피|빽다방|더벤티/i;
const GENERIC_EVIDENCE = /전국\s*\d|전국에|매장\s*\d|프랜차이즈|업계\s*1위|브랜드\s*가치|창업|가맹|설립된|매출|대표이사|본사|유명한\s*곳|인기\s*있는\s*곳|다양한\s*(?:문화|공연|전시|메뉴|음료|디저트)/;
const CAFE_SPACE_EVIDENCE = /공간|인테리어|좌석|테라스|정원|전망|뷰|한옥|건축|조명|통창|창가|루프탑|야외|층고|갤러리|빈티지/;
const VISIT_STATUS_EVIDENCE = /예약\s*(?:가능|불가|할|하)|영업\s*시간|운영\s*시간|휴무|주차\s*(?:가능|불가)|\b\d{1,2}:\d{2}\b/;
const VENUE_HIGHLIGHT = /정원|테라스|전망|뷰|한옥|건축|조명|통창|창가|루프탑|야외|층고|갤러리|빈티지|전시\s*(?:주제|작품)|공연\s*(?:프로그램|작품)|직접\s*(?:만든|굽|볶|로스팅)|대표\s*메뉴|시그니처|수제|핸드드립|원두|로스터리|체험\s*(?:프로그램|활동)|역사적|문화재/;

export function decisionUsefulVenueObservation(candidate: DiscoverCandidate, text: string) {
  if (GENERIC_EVIDENCE.test(text) || VISIT_STATUS_EVIDENCE.test(text) || /(?:에|에\s*)위치한|주소는|전화번호는/.test(text)) return false;
  if (VENUE_HIGHLIGHT.test(text)) return true;
  // Rephrasing the provider's business type or the food already in the name
  // is not evidence that this particular stop is worth a date.
  const nameFood = candidate.name.match(/냉면|칼국수|파스타|초밥|스시|라멘|만두|케이크|커피|오리|고기/)?.[0];
  if (nameFood && text.includes(nameFood) && /전문점|주로\s*제공|다양한|유명/.test(text)) return false;
  return /메뉴|디저트|공간|풍경|산책로|볼거리|작품|전시|공연|활동/.test(text)
    && !/(?:카페|식당|공연장|전시관)(?:로|으로).*?(?:카페|식당|공연장|전시관)입니다/.test(text);
}

function experienceTour(state: AIPlannerState, slot: "meal" | "cafe") {
  const requests = state.userRequests?.length ? state.userRequests : state.conversationNotes;
  const notes = requests.join(" ");
  const last = requests.at(-1) ?? "";
  if (slot === "meal") return /(?:맛집|식당|음식|미식|먹방)\s*(?:투어|위주)|점심.{0,20}저녁|저녁.{0,20}야식/.test(notes)
    || /(?:식당|맛집|음식점|점심|저녁|야식).{0,12}(?:추가|넣어)/.test(last);
  return /(?:카페|커피|디저트)\s*(?:투어|위주)|카페만\s*(?:가자|갈게|돌|보)/.test(notes)
    || /(?:카페|커피|디저트).{0,12}(?:추가|넣어)/.test(last);
}

export function requestedRepeat(state: AIPlannerState, slot: string) {
  if (slot === "meal" || slot === "cafe") return experienceTour(state, slot);
  const last = (state.userRequests?.length ? state.userRequests : state.conversationNotes).at(-1) ?? "";
  const names: Record<string, string> = { performance: "공연|연극|뮤지컬", exhibit: "전시|미술|박물", movie: "영화", walk: "산책|공원", indoor: "보드게임|방탈출|놀거리", nightview: "야경|전망" };
  return Boolean(names[slot] && new RegExp(`(?:${names[slot]}).{0,12}(?:추가|넣어|더)`).test(last));
}

export function wantsCafeAtmosphere(state: AIPlannerState) {
  const requests = state.userRequests?.length ? state.userRequests : state.conversationNotes;
  return /예쁜|이쁜|감성|분위기|아늑|인테리어|뷰|전망|사진\s*잘|통창|한옥/.test(requests.join(" "));
}

export function hasCafeSpaceEvidence(candidate: DiscoverCandidate) {
  return (candidate.evidence ?? []).some(evidence => (!evidence.venueId || evidence.venueId === dateCandidateKey(candidate))
    && decisionUsefulVenueObservation(candidate, evidence.text) && CAFE_SPACE_EVIDENCE.test(evidence.text));
}

export function usefulVenueEvidence(candidate: DiscoverCandidate, state: AIPlannerState) {
  const priorities = state.discovery?.priorities ?? [];
  return [...(candidate.evidence ?? [])]
    .filter(evidence => (!evidence.venueId || evidence.venueId === dateCandidateKey(candidate))
      && decisionUsefulVenueObservation(candidate, evidence.text))
    .sort((a, b) => {
      const score = (text: string) => priorities.reduce((sum, priority) =>
        sum + Number(priority.split(/\s+/).filter(word => word.length >= 2).some(word => compact(text).includes(compact(word)))) * 5, 0)
        + Number(/메뉴|시그니처|원두|디저트|정원|테라스|전망|건축|인테리어|전시|공연|체험|풍경/.test(text)) * 3
        + Number(candidateActivitySlot(candidate) === "cafe" && wantsCafeAtmosphere(state) && CAFE_SPACE_EVIDENCE.test(text)) * 20;
      return score(b.text) - score(a.text);
    })[0];
}

function genericChainCafe(candidate: DiscoverCandidate) {
  return candidateActivitySlot(candidate) === "cafe" && CHAIN_CAFE.test(candidate.name);
}

export function hardCourseProblems(problems: string[]) {
  return problems.filter(problem => /검색으로 확인되지|같은 장소 중복|요청에 맞지 않는 장소 수|일차 누락|유지할 장소 누락|제외 요청한 장소 포함|요청 활동 누락|음식 종류 불일치|유지할 순서 불일치|지정한 시간|이동 부담|도보 부담|기준 동네에서 먼 장소|카페 중복|식사 중복|추가 경험 중복|카페 공간 근거 부족|매력 근거 없는 프랜차이즈/.test(problem));
}

export function venueQuality(candidate: DiscoverCandidate, state: AIPlannerState, saved = new Set<string>()) {
  const evidence = usefulVenueEvidence(candidate, state);
  const blob = compact(`${candidate.name} ${candidate.detailedCategory} ${candidate.dishes} ${evidence?.text ?? ""}`);
  const preferences = state.discovery?.priorities ?? [];
  const relevance = preferences.reduce((score, preference) => {
    const terms = preference.split(/\s+/).filter(term => term.length >= 2);
    return score + (terms.some(term => blob.includes(compact(term))) ? 5 : 0);
  }, 0);
  // A rating without a known provider/scale is not a quality measure.
  return (evidence ? 12 : 0) + relevance
    + (candidateActivitySlot(candidate) === "cafe" && wantsCafeAtmosphere(state) && hasCafeSpaceEvidence(candidate) ? 16 : 0)
    + (saved.has(candidate.name) ? 7 : 0)
    + (matchesCuisine(candidate, state.cuisine) && candidateActivitySlot(candidate) === "meal" ? 4 : 0)
    + (candidate.factSourceUrl && candidate.factNote ? 3 : 0)
    - (genericChainCafe(candidate) && !evidence && !state.requiredPlaces.some(name => matchesTerm(candidate, name)) ? 18 : 0);
}

/** Select across neighborhoods and experiences AFTER gathering all search results. */
export function discoveryCatalog(pool: DiscoverCandidate[], state: AIPlannerState, saved: Set<string>, limit = 54) {
  const ranked = [...pool].sort((a, b) => venueQuality(b, state, saved) - venueQuality(a, state, saved));
  const chosen: DiscoverCandidate[] = [];
  const used = new Set<string>();
  const buckets = new Map<string, DiscoverCandidate[]>();
  const add = (candidate: DiscoverCandidate) => {
    const key = dateCandidateKey(candidate);
    if (used.has(key) || chosen.length >= limit) return;
    chosen.push(candidate);
    used.add(key);
  };
  for (const candidate of ranked) {
    if (state.requiredPlaces.some(name => matchesTerm(candidate, name))) add(candidate);
    const [lng, lat] = candidate.coordinates;
    const cell = `${candidateActivitySlot(candidate)}:${Math.round(lng * 100)}:${Math.round(lat * 100)}`;
    const group = buckets.get(cell) ?? [];
    group.push(candidate);
    buckets.set(cell, group);
  }
  // Reserve room for each experience before broad geographic filling. Search
  // result order otherwise lets abundant restaurants crowd out performances.
  const wanted = state.discovery?.requiredActivities.length ? state.discovery.requiredActivities
    : state.activities.length ? state.activities
      : (["meal", "cafe", "walk", "exhibit", "performance"] as const);
  const quota = Math.max(3, Math.min(6, Math.floor(limit / Math.max(1, wanted.length * 2))));
  for (const slot of wanted) {
    let count = 0;
    for (const candidate of ranked) {
      if (candidateActivitySlot(candidate) !== slot) continue;
      if (used.has(dateCandidateKey(candidate))) { count++; continue; }
      if (count >= quota || chosen.length >= limit) break;
      add(candidate);
      count++;
    }
  }
  while (chosen.length < limit) {
    let added = false;
    for (const group of buckets.values()) {
      while (group.length && used.has(dateCandidateKey(group[0]))) group.shift();
      const candidate = group.shift();
      if (!candidate) continue;
      add(candidate); added = true;
      if (chosen.length >= limit) break;
    }
    if (!added) break;
  }
  return chosen.slice(0, limit);
}

export function parseCourseProposals(value: unknown, days: number): CourseProposal[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const object = raw as Record<string, unknown>;
    if (!Array.isArray(object.selected)) return [];
    const rows = object.selected.slice(0, 12).flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string") return [];
      const day = finite(row.day_index, 0);
      if (!Number.isInteger(day) || day < 0 || day >= days) return [];
      return [{ id: row.id, day_index: day, duration_minutes: Math.max(30, Math.min(180, finite(row.duration_minutes, 60))) }];
    });
    return rows.length ? [{ theme: typeof object.theme === "string" ? object.theme.replace(/[\n*_#]/g, " ").trim().slice(0, 90) : "", rows }] : [];
  });
}

function sequenceAllowed(rows: DateCourseRow[], byId: Map<string, DiscoverCandidate>, state: AIPlannerState) {
  if (state.preserveExistingPlaces && state.pinOrder.length > 1) {
    const pins = rows.map(row => state.pinOrder.findIndex(name => matchesTerm(byId.get(row.id!)!, name))).filter(index => index >= 0);
    if (pins.some((pin, index) => index > 0 && pin < pins[index - 1])) return false;
  }
  const order = state.discovery?.activityOrder ?? [];
  const positions = order.map(activity => rows.findIndex(row => matchesActivity(byId.get(row.id!)!, activity))).filter(index => index >= 0);
  return !positions.some((position, index) => index > 0 && position < positions[index - 1]);
}

function routeCost(rows: DateCourseRow[], byId: Map<string, DiscoverCandidate>) {
  let meters = 0;
  let longestHop = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].day_index !== rows[i - 1].day_index) continue;
    const hop = distanceMeters(byId.get(rows[i - 1].id!)!.coordinates, byId.get(rows[i].id!)!.coordinates);
    meters += hop; longestHop = Math.max(longestHop, hop);
  }
  return { meters, longestHop };
}

/** Search complete permutations per day (up to 7 stops), preserving explicit order constraints. */
function optimizeDay(rows: DateCourseRow[], byId: Map<string, DiscoverCandidate>, state: AIPlannerState) {
  if (rows.length < 2 || rows.length > 7) return rows;
  let best: DateCourseRow[] | null = null;
  let cost = Infinity;
  const visit = (path: DateCourseRow[], rest: DateCourseRow[], length: number) => {
    if (length >= cost) return;
    if (!rest.length) {
      if (sequenceAllowed(path, byId, state)) { best = path; cost = length; }
      return;
    }
    for (let index = 0; index < rest.length; index++) {
      const row = rest[index];
      const previous = path.at(-1);
      const hop = previous ? distanceMeters(byId.get(previous.id!)!.coordinates, byId.get(row.id!)!.coordinates) : 0;
      visit([...path, row], rest.filter((_, i) => i !== index), length + hop);
    }
  };
  visit([], rows, 0);
  return best ?? rows;
}

export function evaluateCourse(proposal: CourseProposal, candidates: DiscoverCandidate[], state: AIPlannerState, saved: Set<string>): CourseEvaluation {
  const byId = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  const problems: string[] = [];
  const ids = proposal.rows.map(row => row.id);
  if (ids.some(id => !id || !byId.has(id))) problems.push("검색으로 확인되지 않은 장소");
  if (new Set(ids).size !== ids.length) problems.push("같은 장소 중복");
  const valid = proposal.rows.filter(row => row.id && byId.has(row.id));
  const days = courseSize(state).days;
  let rows = Array.from({ length: days }, (_, day) => optimizeDay(valid.filter(row => (row.day_index ?? 0) === day), byId, state)).flat();
  const selected = rows.map(row => byId.get(row.id!)!);
  const max = state.discovery?.maxStops ?? courseSize(state).max;
  if (rows.length < Math.max(2, state.discovery?.minStops ?? 2) || rows.length > Math.max(max, state.requiredPlaces.length)) problems.push("요청에 맞지 않는 장소 수");
  for (let day = 0; day < days; day++) if (!rows.some(row => (row.day_index ?? 0) === day)) problems.push(`${day + 1}일차 누락`);
  for (const name of state.requiredPlaces) if (!selected.some(candidate => matchesTerm(candidate, name))) problems.push(`유지할 장소 누락: ${name}`);
  if (selected.some(candidate => state.excludedPlaces.some(name => matchesTerm(candidate, name)))) problems.push("제외 요청한 장소 포함");
  if (state.addStop && state.pinOrder.length) {
    const previousSlots = new Set(selected.filter(candidate => state.pinOrder.some(name => matchesTerm(candidate, name))).map(candidateActivitySlot));
    const added = selected.filter(candidate => !state.pinOrder.some(name => matchesTerm(candidate, name)));
    if (added.some(candidate => {
      const slot = candidateActivitySlot(candidate);
      return slot !== "other" && previousSlots.has(slot) && !requestedRepeat(state, slot);
    })) problems.push("추가 경험 중복");
  }
  const requested = state.discovery?.requiredActivities ?? state.activities;
  for (const activity of requested) if (!selected.some(candidate => matchesActivity(candidate, activity))) problems.push(`요청 활동 누락: ${activity}`);
  if (selected.some(candidate => candidateActivitySlot(candidate) === "meal" && !matchesCuisine(candidate, state.cuisine) && !state.requiredPlaces.some(name => matchesTerm(candidate, name)))) problems.push("요청한 음식 종류 불일치");
  if (selected.some(candidate => genericChainCafe(candidate) && !usefulVenueEvidence(candidate, state)
    && !state.requiredPlaces.some(name => matchesTerm(candidate, name))
    && candidates.some(other => dateCandidateKey(other) !== dateCandidateKey(candidate) && candidateActivitySlot(other) === "cafe"
      && !genericChainCafe(other) && distanceMeters(candidate.coordinates, other.coordinates) < 2200))) {
    problems.push("매력 근거 없는 프랜차이즈 카페");
  }
  if (wantsCafeAtmosphere(state) && selected.some(candidate => candidateActivitySlot(candidate) === "cafe"
    && !state.requiredPlaces.some(name => matchesTerm(candidate, name)) && !hasCafeSpaceEvidence(candidate)
    && candidates.some(other => candidateActivitySlot(other) === "cafe" && hasCafeSpaceEvidence(other)
      && distanceMeters(candidate.coordinates, other.coordinates) < 2200))) {
    problems.push("카페 공간 근거 부족");
  }
  if (!sequenceAllowed(rows, byId, state)) problems.push("유지할 순서 불일치");
  for (let day = 0; day < days; day++) {
    const slots = rows.filter(row => row.day_index === day).map(row => candidateActivitySlot(byId.get(row.id!)!));
    if (!isExclusiveCrawl(state) && slots.length > 1 && new Set(slots).size < 2) problems.push(`${day + 1}일차 경험이 한 종류로 반복`);
    if (!experienceTour(state, "cafe") && slots.filter(slot => slot === "cafe").length > 1) problems.push("카페 중복");
    if (!experienceTour(state, "meal") && slots.filter(slot => slot === "meal").length > 1) problems.push("식사 중복");
  }
  const route = routeCost(rows, byId);
  const travel = isTravelPlan(state);
  if (!travel && selectedAreas(state).length === 1 && state.areaScope !== "nearby"
    && selected.some(candidate => typeof candidate.distanceMeters === "number"
      && candidate.distanceMeters > (state.areaScope === "core" ? 1200 : 1600)
      && !state.requiredPlaces.some(name => matchesTerm(candidate, name)))) {
    problems.push("기준 동네에서 먼 장소");
  }
  const mode = state.discovery?.transport ?? (travel ? "transit" : "walk");
  const maxHop = travel ? 45000
    : state.walkingPreference === "short" ? 900
      : state.areaScope === "nearby" || mode === "drive" ? 4500
        : state.areaScope === "core" ? 1200 : 1800;
  if (route.longestHop > maxHop) problems.push("한 구간의 이동 부담이 너무 큼");
  if (mode === "walk" && route.meters > (state.walkingPreference === "short" ? 2200 : 5500) * days) problems.push("전체 도보 부담이 너무 큼");
  if (rows.length && !assignStartTimes(rows, candidates, state).length) problems.push("지정한 시간 안에 이동과 체류를 배치할 수 없음");
  const evidenceCount = selected.reduce((sum, candidate) => sum + (candidate.evidence?.length ?? 0), 0);
  const averageQuality = selected.length ? selected.reduce((sum, candidate) => sum + venueQuality(candidate, state, saved), 0) / selected.length : 0;
  const diversity = new Set(selected.map(candidateActivitySlot)).size;
  const score = averageQuality + Math.min(3, diversity) * 4 - route.meters / (travel ? 3000 : 350) - route.longestHop / (travel ? 7000 : 900) - problems.length * 100;
  rows = rows.map(row => ({ ...row, duration_minutes: row.duration_minutes ?? defaultDuration(byId.get(row.id!)!, state.pace) }));
  return { ...proposal, rows, score, ...route, evidenceCount, problems: [...new Set(problems)] };
}

/** Bounded beam search is an explicit degraded path, not a substitute for editorial judgment. */
export function buildFallbackCourse(candidates: DiscoverCandidate[], state: AIPlannerState, saved: Set<string>): CourseProposal {
  const days = courseSize(state).days;
  const ranked = candidates.filter(candidate => !state.excludedPlaces.some(name => matchesTerm(candidate, name))).sort((a, b) => venueQuality(b, state, saved) - venueQuality(a, state, saved));
  const required = [...new Set(state.requiredPlaces.flatMap(name => ranked.find(candidate => matchesTerm(candidate, name)) ?? []))];
  const wanted = state.discovery?.requiredActivities ?? state.activities;
  const target = Math.min(state.discovery?.maxStops ?? 12, Math.max(2 * days, required.length, wanted.length, state.discovery?.minStops ?? 3));
  const catalog = discoveryCatalog(ranked, state, saved, 54);
  let beams: DiscoverCandidate[][] = [required];
  for (let step = required.length; step < target; step++) {
    const next = beams.flatMap(path => catalog.filter(candidate => !path.includes(candidate)).map(candidate => [...path, candidate]));
    next.sort((a, b) => {
      const score = (path: DiscoverCandidate[]) => {
        const coverage = wanted.filter(activity => path.some(candidate => matchesActivity(candidate, activity))).length * 25;
        const quality = path.reduce((sum, candidate) => sum + venueQuality(candidate, state, saved), 0);
        const route = path.slice(1).reduce((sum, candidate, index) => sum + distanceMeters(path[index].coordinates, candidate.coordinates), 0);
        const violations = path.filter(candidate => candidateActivitySlot(candidate) === "meal" && !matchesCuisine(candidate, state.cuisine) && !required.includes(candidate)).length;
        const counts = path.reduce((map, candidate) => {
          const slot = candidateActivitySlot(candidate);
          map.set(slot, (map.get(slot) ?? 0) + 1);
          return map;
        }, new Map<string, number>());
        const repeats = (experienceTour(state, "meal") ? 0 : Math.max(0, (counts.get("meal") ?? 0) - days))
          + (experienceTour(state, "cafe") ? 0 : Math.max(0, (counts.get("cafe") ?? 0) - days));
        const oldSlots = new Set(path.filter(candidate => state.pinOrder.some(name => matchesTerm(candidate, name))).map(candidateActivitySlot));
        const unrequestedRepeats = state.addStop ? path.filter(candidate => {
          const slot = candidateActivitySlot(candidate);
          return !state.pinOrder.some(name => matchesTerm(candidate, name))
            && slot !== "other" && oldSlots.has(slot) && !requestedRepeat(state, slot);
        }).length : 0;
        return coverage + quality - violations * 1000 - (repeats + unrequestedRepeats) * 1000
          - route / (isTravelPlan(state) ? 5000 : 350) + counts.size * 8;
      };
      return score(b) - score(a);
    });
    beams = next.slice(0, 12);
    if (!beams.length) break;
  }
  const proposals = beams.map(path => ({ theme: "", rows: path.map((candidate, index) => ({ id: dateCandidateKey(candidate), day_index: Math.min(days - 1, Math.floor(index * days / path.length)), duration_minutes: defaultDuration(candidate, state.pace) })) }));
  return proposals.map(proposal => evaluateCourse(proposal, candidates, state, saved)).sort((a, b) => a.problems.length - b.problems.length || b.score - a.score)[0] ?? { theme: "", rows: [] };
}

/** Different anchor neighborhoods produce feasible alternatives before LLM curation. */
export function feasibleCourseSeeds(candidates: DiscoverCandidate[], state: AIPlannerState, saved: Set<string>): CourseEvaluation[] {
  const anchors = discoveryCatalog(candidates, state, saved, 6);
  const radius = isTravelPlan(state) ? 18000 : state.discovery?.transport === "walk" ? 1800 : 3500;
  const proposals = [candidates, ...anchors.map(anchor => candidates.filter(candidate =>
    state.requiredPlaces.some(name => matchesTerm(candidate, name)) || distanceMeters(anchor.coordinates, candidate.coordinates) <= radius
  ))].map(pool => evaluateCourse(buildFallbackCourse(pool, state, saved), candidates, state, saved));
  const seen = new Set<string>();
  return proposals.filter(course => {
    if (hardCourseProblems(course.problems).length) return false;
    const key = course.rows.map(row => row.id).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}
