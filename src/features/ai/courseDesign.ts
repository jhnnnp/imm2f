import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import { courseSize, isExclusiveCrawl, isTravelPlan, matchesActivity, matchesCuisine, matchesTerm, selectedAreas, tripDayYmd } from "./dateBrief";
import { festivalPeriodCoversYmd } from "@/lib/tourapi/festivalSchedule";
import { candidateActivitySlot, dateCandidateKey, defaultDuration, assignStartTimes, type DateCourseRow } from "./dateCourse";
import { candidateFoodConflict } from "./dateIntent";
import { evidenceConfidence } from "./dateEvidence";

export type CourseProposal = { theme: string; rows: DateCourseRow[] };
export type CourseEvaluation = CourseProposal & { score: number; meters: number; longestHop: number; evidenceCount: number; problems: string[];
  scoreBreakdown?: { venues: number; evidence: number; diversity: number; route: number; flow: number; pacing: number; schedule: number; violations: number } };
/** A verified deterministic seed is the stable baseline; an LLM alternative
 * must improve venue/experience quality enough to displace it. Walking detour
 * is charged only beyond the straight-line distance already in course.score. */
export function courseSelectionScore(course: CourseEvaluation, walkingMeters?: number, deterministicSeed = false) {
  return course.score + (deterministicSeed ? 6 : 0)
    - Math.max(0, (walkingMeters ?? course.meters) - course.meters) / 350;
}
const finite = (n: unknown, fallback: number) => typeof n === "number" && Number.isFinite(n) ? n : fallback;
const compact = (text: string) => text.replace(/\s/g, "").toLowerCase();
const CHAIN_CAFE = /할리스|스타벅스|투썸플레이스|이디야|엔제리너스|커피빈|폴바셋|탐앤탐스|카페베네|메가\s*MGC|메가커피|컴포즈커피|빽다방|더벤티/i;
const GENERIC_EVIDENCE = /전국\s*\d|전국에|매장\s*\d|프랜차이즈|업계\s*1위|브랜드\s*가치|창업|가맹|설립된|매출|대표이사|본사|유명한\s*곳|인기\s*있는\s*곳|다양한\s*(?:문화|공연|전시|메뉴|음료|디저트)/;
const CAFE_SPACE_EVIDENCE = /공간|인테리어|좌석|테라스|정원|전망|(?<!리)뷰|한옥|건축|조명|통창|창가|루프탑|야외|층고|갤러리|빈티지/;
const VISIT_STATUS_EVIDENCE = /예약\s*(?:가능|불가|할|하)|영업\s*시간|운영\s*시간|휴무|주차\s*(?:가능|불가)|\b\d{1,2}:\d{2}\b/;
const VENUE_HIGHLIGHT = /정원|테라스|전망|뷰|한옥|건축|조명|통창|창가|루프탑|야외|층고|갤러리|빈티지|전시\s*(?:주제|작품)|공연\s*(?:프로그램|작품)|직접\s*(?:만든|굽|볶|로스팅)|대표\s*메뉴|시그니처|수제|핸드드립|원두|로스터리|체험\s*(?:프로그램|활동)|역사적|문화재/;
const SPECIFIC_FOOD = /플랫\s*화이트|에스프레소|라테|라떼|크루아상|휘낭시에|소금빵|티라미수|치즈케이크|수플레|스테이크|리소토|리조토|뇨키|트러플|봉골레|라구|오마카세|숙성|직접\s*(?:뽑|끓|반죽|구운)|제철\s*(?:생선|재료|해산물)/;

export function decisionUsefulVenueObservation(candidate: DiscoverCandidate, text: string) {
  if (GENERIC_EVIDENCE.test(text) || VISIT_STATUS_EVIDENCE.test(text) || /(?:에|에\s*)위치한|주소는|전화번호는/.test(text)) return false;
  if (VENUE_HIGHLIGHT.test(text)) return true;
  if ((candidateActivitySlot(candidate) === "meal" || candidateActivitySlot(candidate) === "cafe")
    && SPECIFIC_FOOD.test(text) && !/최고|최상|무조건|맛있|맛집|인기|유명/.test(text)) return true;
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

/** A menu citation does not complete research for an aesthetic cafe request. */
export function hasRequestedVenueEvidence(candidate: DiscoverCandidate, state: AIPlannerState) {
  if (candidateActivitySlot(candidate) === "performance" && candidate.performanceEvent) return true;
  return candidateActivitySlot(candidate) === "cafe" && wantsCafeAtmosphere(state)
    ? hasCafeSpaceEvidence(candidate) : Boolean(usefulVenueEvidence(candidate, state));
}

export function usefulVenueEvidence(candidate: DiscoverCandidate, state: AIPlannerState) {
  const priorities = state.discovery?.priorities ?? [];
  const month = Number(state.dateLabel?.match(/^\d{4}-?(\d{2})/)?.[1] ?? 0);
  const season = month >= 3 && month <= 5 ? "봄" : month >= 6 && month <= 8 ? "여름"
    : month >= 9 && month <= 11 ? "가을" : month === 12 || month <= 2 && month > 0 ? "겨울" : "";
  return [...(candidate.evidence ?? [])]
    .filter(evidence => (!evidence.venueId || evidence.venueId === dateCandidateKey(candidate))
      && decisionUsefulVenueObservation(candidate, evidence.text)
      && (!season || !/제철|계절\s*한정|시즌\s*한정/.test(evidence.text)
        || !["봄", "여름", "가을", "겨울"].some(other => other !== season && evidence.text.includes(other))))
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
  return problems.filter(problem => /검색으로 확인되지|같은 장소 중복|요청에 맞지 않는 장소 수|일차 누락|일차 일정 부족|일차 장소 과밀|여행일 핵심 경험 누락|여행일 식사 누락|여행 핵심 장소 근거 부족|축제 날짜 불일치|공연 날짜 불일치|유지할 장소 누락|제외 요청한 장소 포함|요청 활동 누락|음식 종류 불일치|제외 음식이 포함된 장소|알레르기 안전성 미확인|확인된 비용이 예산 초과|유지할 순서 불일치|방문일 공연 회차 미확인|지정한 시간|이동 부담|도보 부담|기준 동네에서 먼 장소|카페 중복|식사 중복|추가 경험 중복|카페 공간 근거 부족|매력 근거 없는 프랜차이즈/.test(problem));
}

export function venueScoreBreakdown(candidate: DiscoverCandidate, state: AIPlannerState, saved = new Set<string>()) {
  const evidence = usefulVenueEvidence(candidate, state);
  const blob = compact(`${candidate.name} ${candidate.detailedCategory} ${candidate.dishes} ${evidence?.text ?? ""}`);
  const preferences = state.discovery?.priorities ?? [];
  const relevance = preferences.reduce((score, preference) => {
    const terms = preference.split(/\s+/).filter(term => term.length >= 2);
    return score + (terms.some(term => blob.includes(compact(term))) ? 5 : 0);
  }, 0);
  const spaceFacts = (candidate.evidence ?? []).filter(fact => fact.attribute === "space"
    && decisionUsefulVenueObservation(candidate, fact.text));
  const spaceFeatures = new Set(spaceFacts.flatMap(fact =>
    [...fact.text.matchAll(/정원|테라스|루프탑|통창|한옥|전망|(?<!리)뷰|채광|자연광|창가|갤러리|건축|빈티지|인테리어/g)]
      .map(match => match[0])));
  const spaceQuality = candidateActivitySlot(candidate) === "cafe" && wantsCafeAtmosphere(state)
    ? Math.min(12, spaceFeatures.size * 4) - (spaceFacts.some(fact => /좁게|시끄럽|불편/.test(fact.text)) ? 5 : 0)
    : 0;
  const menuQuality = candidateActivitySlot(candidate) === "meal" && (candidate.evidence ?? [])
    .some(fact => fact.attribute === "menu" && decisionUsefulVenueObservation(candidate, fact.text)) ? 5 : 0;
  const evidenceText = (candidate.evidence ?? []).filter(fact => !fact.venueId || fact.venueId === dateCandidateKey(candidate))
    .map(fact => fact.text).join(" ");
  const preferenceText = `${candidate.name} ${candidate.detailedCategory ?? ""} ${evidenceText}`;
  const softPreferences = state.preferences;
  const quietEvidence = /조용|한적|프라이빗|독립된\s*좌석|대화하기\s*좋/.test(evidenceText);
  const crowdEvidence = /혼잡|붐비|북적|시끄럽|대기\s*줄|웨이팅/.test(preferenceText);
  const scenicEvidence = /전망|한강|야경|정원|테라스|통창|산책로|풍경/.test(evidenceText);
  const preferenceFit = (softPreferences?.vibe ?? []).reduce((score, vibe) =>
    score + Number(evidenceText.includes(vibe)) * 3, 0)
    + (quietEvidence ? (1 - (softPreferences?.crowdTolerance ?? 0.5)) * 8 : 0)
    - (crowdEvidence ? (1 - (softPreferences?.crowdTolerance ?? 0.5)) * 12 : 0)
    + (scenicEvidence ? (softPreferences?.scenicPreference ?? 0) * 8 : 0)
    + (state.memorySuggestions?.activities.some(activity => matchesActivity(candidate, activity)) ? 3 : 0)
    + (!state.cuisine && state.memorySuggestions?.cuisine && candidateActivitySlot(candidate) === "meal"
      && matchesCuisine(candidate, state.memorySuggestions.cuisine) ? 2 : 0);
  // A rating without a known provider/scale is not a quality measure.
  const quality = relevance + spaceQuality + menuQuality
    + (candidateActivitySlot(candidate) === "cafe" && wantsCafeAtmosphere(state) && hasCafeSpaceEvidence(candidate) ? 16 : 0)
    + (matchesCuisine(candidate, state.cuisine) && candidateActivitySlot(candidate) === "meal" ? 4 : 0);
  const evidenceScore = (evidence ? 12 : 0)
    + (candidateActivitySlot(candidate) === "performance" && candidate.performanceEvent ? 20 : 0)
    + (candidate.factSourceUrl && candidate.factNote ? 3 : 0);
  const remembered = state.memorySignals?.filter(signal => compact(signal.placeName) === compact(candidate.name)) ?? [];
  const context = (saved.has(candidate.name) ? 7 : 0) + remembered.reduce((score, signal) =>
    score + signal.confidence * (signal.reaction === "liked" ? 5 : signal.reaction === "disliked" ? -16
      : -8 * (1 - (softPreferences?.crowdTolerance ?? 0.5))), 0);
  const novelty = genericChainCafe(candidate) && !state.requiredPlaces.some(name => matchesTerm(candidate, name))
    ? -(softPreferences?.novelty ?? 0) * 8 - (wantsCafeAtmosphere(state) ? 10 : !evidence ? 18 : 0) : 0;
  const foodFit = candidateActivitySlot(candidate) === "meal" ? (softPreferences?.foodImportance ?? 0) * (menuQuality + 3) : 0;
  return { preferenceFit: preferenceFit + foodFit, quality, evidence: evidenceScore, context, novelty };
}

export function venueQuality(candidate: DiscoverCandidate, state: AIPlannerState, saved = new Set<string>()) {
  return Object.values(venueScoreBreakdown(candidate, state, saved)).reduce((sum, value) => sum + value, 0);
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
    if (candidate.discoveryLeadUrl) add(candidate);
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

function meaningfulTripExperience(candidate: DiscoverCandidate) {
  return ["tourist", "nature", "festival"].includes(candidate.category)
    || ["exhibit", "indoor", "nightview", "performance", "movie"].includes(candidateActivitySlot(candidate));
}

/** Soft preference: a new trip day should offer a distinct anchor experience.
 * This never overrides requested places or feasibility checks. */
function tripAnchorVariety(anchors: DiscoverCandidate[]) {
  let score = 0;
  for (let index = 1; index < anchors.length; index++) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    const meters = distanceMeters(previous.coordinates, current.coordinates);
    if (previous.category !== current.category) score += 9;
    if (meters >= 3000 && meters <= 18000) score += 7;
    if (meters < 1800 && previous.category === current.category) score -= 14;
  }
  return score;
}

function experienceFlowScore(places: DiscoverCandidate[], state: AIPlannerState) {
  if (isTravelPlan(state) || places.length < 2) return 0;
  const slots = places.map(candidateActivitySlot);
  let score = 0;
  for (let index = 1; index < slots.length; index++) {
    if (slots[index - 1] === "meal" && slots[index] === "cafe") score += 1.5;
    if (["exhibit", "performance", "movie", "indoor"].includes(slots[index - 1]) && slots[index] === "meal") score += 1;
    if (slots[index - 1] === slots[index]) score -= 1;
  }
  if (/대화|조용|편안|오랜만/.test(state.objective ?? "") && ["cafe", "walk", "nightview"].includes(slots.at(-1)!)) score += 1.5;
  return Math.max(-2, Math.min(4, score));
}

/** Search complete permutations per day (up to 7 stops), preserving explicit order constraints. */
function optimizeDay(rows: DateCourseRow[], byId: Map<string, DiscoverCandidate>, state: AIPlannerState) {
  if (rows.length < 2 || rows.length > 7) return rows;
  let best: DateCourseRow[] | null = null;
  let cost = Infinity;
  const visit = (path: DateCourseRow[], rest: DateCourseRow[], length: number) => {
    if (!rest.length) {
      const score = length - experienceFlowScore(path.map(row => byId.get(row.id!)!), state) * 160;
      if (score < cost && sequenceAllowed(path, byId, state)) { best = path; cost = score; }
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
  const max = Math.max(state.discovery?.maxStops ?? courseSize(state).max, courseSize(state).min);
  if (rows.length < Math.max(courseSize(state).min, state.discovery?.minStops ?? 2)
    || rows.length > Math.max(max, state.requiredPlaces.length)) problems.push("요청에 맞지 않는 장소 수");
  for (let day = 0; day < days; day++) if (!rows.some(row => (row.day_index ?? 0) === day)) problems.push(`${day + 1}일차 누락`);
  const travel = isTravelPlan(state);
  const tripThemeException = isExclusiveCrawl(state)
    || /먹방|미식|호캉스|숙소.{0,8}(?:휴식|쉬)|휴양/.test(state.userRequests?.at(-1) ?? "");
  const needsDailyMeal = travel && days > 1 && !isExclusiveCrawl(state)
    && !/식사.{0,8}(?:빼|제외|없이)|음식.{0,8}(?:빼|제외|없이)/.test(state.userRequests?.at(-1) ?? "")
    && candidates.filter(candidate => candidateActivitySlot(candidate) === "meal").length >= days;
  if (travel) for (let day = 0; day < days; day++) {
    const dayRows = rows.filter(row => (row.day_index ?? 0) === day);
    if (dayRows.length > 4) problems.push(`${day + 1}일차 장소 과밀`);
    if (days > 2 && dayRows.length < (day === 0 || day === days - 1 ? 2 : 3))
      problems.push(`${day + 1}일차 일정 부족`);
    if (needsDailyMeal && dayRows.length && !dayRows.some(row => candidateActivitySlot(byId.get(row.id!)!) === "meal"))
      problems.push(`${day + 1}일차 여행일 식사 누락`);
    if (dayRows.length && !tripThemeException && !dayRows.some(row => meaningfulTripExperience(byId.get(row.id!)!))) {
      problems.push(`${day + 1}일차 여행일 핵심 경험 누락`);
    }
    if (dayRows.length && !tripThemeException && !dayRows.some(row => {
      const candidate = byId.get(row.id!)!;
      return meaningfulTripExperience(candidate) && hasRequestedVenueEvidence(candidate, state);
    })) problems.push(`${day + 1}일차 여행 핵심 장소 근거 부족`);
    if (dayRows.some(row => {
      const candidate = byId.get(row.id!)!;
      return candidate.category === "festival" && !festivalPeriodCoversYmd(candidate.openingHours, tripDayYmd(state, day));
    })) problems.push(`${day + 1}일차 축제 날짜 불일치`);
    if (dayRows.some(row => {
      const event = byId.get(row.id!)!.performanceEvent;
      return event && event.dateYmd !== tripDayYmd(state, day);
    })) problems.push(`${day + 1}일차 공연 날짜 불일치`);
  }
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
  const latestRequest = state.userRequests?.at(-1) ?? "";
  const eventDate = state.dateLabel?.replace(/\D/g, "").slice(0, 8);
  if (state.intent !== "modify" && eventDate && /공연(?!장)|연극|뮤지컬|콘서트/.test(latestRequest)
    && !selected.some(candidate => candidate.performanceEvent
      && Array.from({ length: days }, (_, day) => tripDayYmd(state, day)).includes(candidate.performanceEvent.dateYmd))) {
    problems.push("방문일 공연 회차 미확인");
  }
  if (selected.some(candidate => candidateActivitySlot(candidate) === "meal" && !matchesCuisine(candidate, state.cuisine) && !state.requiredPlaces.some(name => matchesTerm(candidate, name)))) problems.push("요청한 음식 종류 불일치");
  if (selected.some(candidate => candidateFoodConflict(`${candidate.name} ${candidate.detailedCategory ?? ""} ${candidate.dishes ?? ""} ${(candidate.evidence ?? []).filter(fact => fact.attribute === "menu").map(fact => fact.text).join(" ")}`, state.excludedFoods ?? []))) {
    problems.push("제외 음식이 포함된 장소");
  }
  if (state.foodAllergy && selected.some(candidate => candidateActivitySlot(candidate) === "meal")) {
    // Search-reported menus cannot establish ingredient or cross-contact safety.
    problems.push("알레르기 안전성 미확인");
  }
  if (state.budgetWon && selected.reduce((sum, candidate) => sum + (candidate.expectedCostTwo ?? 0), 0) > state.budgetWon) {
    problems.push("확인된 비용이 예산 초과");
  }
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
  if (!travel && selectedAreas(state).length === 1 && state.areaScope !== "nearby"
    && selected.some(candidate => typeof candidate.distanceMeters === "number"
      && candidate.distanceMeters > (state.areaScope === "core" ? 1200 : 1600)
      && !state.requiredPlaces.some(name => matchesTerm(candidate, name)))) {
    problems.push("기준 동네에서 먼 장소");
  }
  const mode = state.discovery?.transport ?? (travel ? "transit" : "walk");
  const maxHop = travel ? mode === "drive" ? 45000 : mode === "walk" ? 4500 : 25000
    : state.walkingPreference === "short" ? 900
      : state.areaScope === "nearby" || mode === "drive" ? 4500
        : state.areaScope === "core" ? 1200 : 1800;
  if (route.longestHop > maxHop) problems.push("한 구간의 이동 부담이 너무 큼");
  if (mode === "walk" && route.meters > (state.walkingPreference === "short" ? 2200 : 5500) * days) problems.push("전체 도보 부담이 너무 큼");
  const timedRows = rows.length ? assignStartTimes(rows, candidates, state) : [];
  if (rows.length && !timedRows.length) problems.push("지정한 시간 안에 이동과 체류를 배치할 수 없음");
  const evidenceCount = selected.filter(candidate => hasRequestedVenueEvidence(candidate, state)).length;
  const provenance = selected.length ? selected.reduce((sum, candidate) => sum + Math.max(
    evidenceConfidence(candidate, "space"), evidenceConfidence(candidate, "menu"),
    evidenceConfidence(candidate, "experience"), evidenceConfidence(candidate, "event")), 0) / selected.length : 0;
  const averageQuality = selected.length ? selected.reduce((sum, candidate) => sum + venueQuality(candidate, state, saved), 0) / selected.length : 0;
  const diversity = new Set(selected.map(candidateActivitySlot)).size;
  // Reward evidence across stops, not many citations for a single cafe.
  const coverage = selected.length ? evidenceCount / selected.length : 0;
  const tripExperienceDays = travel ? Array.from({ length: days }, (_, day) => rows.some(row => {
    const candidate = byId.get(row.id!)!;
    return (row.day_index ?? 0) === day && meaningfulTripExperience(candidate);
  })).filter(Boolean).length : 0;
  const dailyAnchors = travel ? Array.from({ length: days }, (_, day) => rows
    .filter(row => (row.day_index ?? 0) === day)
    .map(row => byId.get(row.id!)!)
    .find(candidate => meaningfulTripExperience(candidate) && hasRequestedVenueEvidence(candidate, state)))
    .filter((candidate): candidate is DiscoverCandidate => Boolean(candidate)) : [];
  const scoreBreakdown = {
    venues: averageQuality,
    evidence: coverage * 20 + provenance * 6,
    diversity: Math.min(3, diversity) * 4 + tripExperienceDays * 7 + (travel ? tripAnchorVariety(dailyAnchors) : 0),
    route: (-route.meters / (travel ? 3000 : 350) - route.longestHop / (travel ? 7000 : 900))
      * (1 + (1 - (state.preferences?.walkingTolerance ?? 0.5)) * 0.7),
    flow: experienceFlowScore(selected, state) * 3,
    pacing: -Math.max(0, selected.length - (travel ? 4 * days : 3)) * 2,
    schedule: rows.length && timedRows.length ? 4 : 0,
    violations: -problems.length * 100,
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  rows = rows.map(row => ({ ...row, duration_minutes: row.duration_minutes ?? defaultDuration(byId.get(row.id!)!, state.pace) }));
  return { ...proposal, rows, score, scoreBreakdown, ...route, evidenceCount, problems: [...new Set(problems)] };
}

/** Bounded beam search is an explicit degraded path, not a substitute for editorial judgment. */
export function buildFallbackCourse(candidates: DiscoverCandidate[], state: AIPlannerState, saved: Set<string>): CourseProposal {
  const days = courseSize(state).days;
  const ranked = candidates.filter(candidate => !state.excludedPlaces.some(name => matchesTerm(candidate, name))).sort((a, b) => venueQuality(b, state, saved) - venueQuality(a, state, saved));
  const required = [...new Set(state.requiredPlaces.flatMap(name => ranked.find(candidate => matchesTerm(candidate, name)) ?? []))];
  const wanted = state.discovery?.requiredActivities ?? state.activities;
  const target = Math.min(Math.max(state.discovery?.maxStops ?? 12, courseSize(state).min),
    Math.max(courseSize(state).min, required.length, wanted.length, state.discovery?.minStops ?? 3));
  const catalog = discoveryCatalog(ranked, state, saved, 54);
  const qualityById = new Map(catalog.map(candidate => [dateCandidateKey(candidate), venueQuality(candidate, state, saved)]));
  const scorePath = (path: DiscoverCandidate[]) => {
    const coverage = wanted.filter(activity => path.some(candidate => matchesActivity(candidate, activity))).length * 25;
    const quality = path.reduce((sum, candidate) => sum + (qualityById.get(dateCandidateKey(candidate)) ?? venueQuality(candidate, state, saved)), 0);
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
    const tripAnchors = isTravelPlan(state) && !isExclusiveCrawl(state)
      ? Math.min(days, path.filter(candidate => meaningfulTripExperience(candidate)
        && hasRequestedVenueEvidence(candidate, state)).length) * 55 : 0;
    const tripMeals = isTravelPlan(state) && days > 1 && !isExclusiveCrawl(state)
      ? Math.min(days, counts.get("meal") ?? 0) * 35 : 0;
    const anchorVariety = isTravelPlan(state) && days > 1
      ? tripAnchorVariety(path.filter(meaningfulTripExperience).slice(0, days)) : 0;
    return coverage + quality - violations * 1000 - (repeats + unrequestedRepeats) * 1000
      - route / (isTravelPlan(state) ? 5000 : 350) + counts.size * 8 + tripAnchors + tripMeals + anchorVariety;
  };
  let beams: DiscoverCandidate[][] = [required];
  for (let step = required.length; step < target; step++) {
    const next = beams.flatMap(path => catalog.filter(candidate => !path.includes(candidate))
      .map(candidate => {
        const expanded = [...path, candidate];
        return { path: expanded, score: scorePath(expanded) };
      }));
    next.sort((a, b) => b.score - a.score);
    beams = next.slice(0, 12).map(item => item.path);
    if (!beams.length) break;
  }
  const proposals = beams.map(path => {
    const anchors = isTravelPlan(state) && days > 1
      ? [...path.filter(candidate => meaningfulTripExperience(candidate) && hasRequestedVenueEvidence(candidate, state)),
        ...path.filter(candidate => meaningfulTripExperience(candidate) && !hasRequestedVenueEvidence(candidate, state))].slice(0, days) : [];
    const perDay = Math.ceil(path.length / days);
    const groups: DiscoverCandidate[][] = Array.from({ length: days }, () => []);
    anchors.forEach((candidate, day) => groups[day].push(candidate));
    for (const candidate of path) {
      if (anchors.includes(candidate)) continue;
      const missingMealDays = candidateActivitySlot(candidate) === "meal"
        ? groups.map((group, index) => ({ group, index })).filter(({ group }) => !group.some(item => candidateActivitySlot(item) === "meal"))
        : [];
      const day = missingMealDays.length && anchors.length === days
        ? missingMealDays.map(({ group, index }) => ({ index, score: distanceMeters(group[0].coordinates, candidate.coordinates) }))
          .sort((a, b) => a.score - b.score)[0].index
        : anchors.length === days
        ? groups.map((group, index) => ({ index, score: distanceMeters(group[0].coordinates, candidate.coordinates)
          + (group.length >= perDay ? 100_000 : 0) })).sort((a, b) => a.score - b.score)[0].index
        : Math.min(days - 1, Math.floor(groups.flat().length * days / path.length));
      groups[day].push(candidate);
    }
    return { theme: "", rows: groups.flatMap((group, day_index) => group.map(candidate => ({
      id: dateCandidateKey(candidate), day_index, duration_minutes: defaultDuration(candidate, state.pace),
    }))) };
  });
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
