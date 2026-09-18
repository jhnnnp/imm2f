import type { DiscoverCandidate, PlaceCategoryId } from "@/features/places/types/place";
import type {
  AIPlannerState,
  DateActivityId,
  DateAreaScope,
  DateCuisine,
  DateCuisineChoice,
  DateIntakeSlot,
  DateStayKind,
  DateTimeWindow,
} from "@/features/planning/types/plan";
import { koreaTodayYmd } from "@/lib/tourapi/festivalSchedule";

export const DATE_ACTIVITY_OPTIONS: ReadonlyArray<{ id: DateActivityId; label: string }> = [
  { id: "cafe", label: "카페" },
  { id: "meal", label: "식사" },
  { id: "walk", label: "산책" },
  { id: "exhibit", label: "전시" },
  { id: "indoor", label: "실내" },
  { id: "nightview", label: "야경" },
];

export const DATE_SCOPE_OPTIONS: ReadonlyArray<{ id: DateAreaScope; label: string }> = [
  { id: "core", label: "이 동네 안에서만" },
  { id: "walkable", label: "걸어갈 주변까지" },
  { id: "nearby", label: "한 정거장 정도는 괜찮아" },
];

export const DATE_AREA_OPTIONS = ["을지로", "성수", "홍대", "한남", "익선동", "제주", "부산", "군산", "포천"] as const;

export const DATE_SPAN_OPTIONS: ReadonlyArray<{ id: DateStayKind; nights: number; label: string }> = [
  { id: "date", nights: 0, label: "데이트" },
  { id: "daytrip", nights: 0, label: "당일치기" },
  { id: "overnight", nights: 1, label: "1박2일" },
  { id: "overnight", nights: 2, label: "2박3일" },
];

export const DATE_TIME_OPTIONS: ReadonlyArray<{ id: DateTimeWindow; label: string; startTime: string | null; endTime: string | null }> = [
  { id: "afternoon", label: "오후부터", startTime: "14:00", endTime: "19:00" },
  { id: "evening", label: "저녁부터", startTime: "17:00", endTime: "22:00" },
  { id: "night", label: "밤부터", startTime: "18:30", endTime: "23:00" },
  { id: "any", label: "상관없음", startTime: null, endTime: null },
];

export const DATE_CUISINE_OPTIONS: ReadonlyArray<{ id: DateCuisineChoice; label: string }> = [
  { id: "한식", label: "한식" },
  { id: "일식", label: "일식" },
  { id: "중식", label: "중식" },
  { id: "양식", label: "양식" },
  { id: "any", label: "상관없음" },
];

export const DATE_INDOOR_OPTIONS = ["방탈출", "보드게임", "볼링", "오락실", "만화카페", "VR 체험", "상관없음"] as const;

export const KNOWN_AREAS = [
  "성수", "서울숲", "건대입구", "건대", "왕십리", "한남", "잠실", "홍대", "연남",
  "합정", "망원", "이태원", "한강", "을지로", "익선동", "강남", "뚝섬", "여의도",
  "신촌", "혜화", "삼청", "북촌", "옥수", "금호", "성수동", "청계천",
  "문래", "서촌", "압구정", "청담", "신사", "삼성", "선릉", "판교", "송리단길",
  "안국", "광화문", "종로", "명동", "충무로", "상수", "연희", "공덕", "마포", "이촌", "용산",
  "해방촌", "성신여대", "성북", "대학로", "송파", "석촌", "영등포", "분당", "정자",
  "군산", "전주", "여수", "제주", "부산", "경주", "강릉", "속초", "가평", "춘천", "양양",
  "익산", "해운대", "광안리", "서귀포", "애월", "포항", "수원", "인천", "송도", "순천",
  "포천", "양평", "파주", "단양", "거제", "남양주",
] as const;

const AREA_STOPWORDS = new Set([
  "오늘", "우리", "그냥", "조금", "같이", "데이트", "일정", "코스", "추천", "생각",
  "이번", "거기", "어디", "여기", "여행", "하루", "저녁", "점심", "오전", "오후",
]);

const AREA_CANON: Record<string, string> = {
  성수: "성수",
  성수동: "성수",
  서울숲: "서울숲",
  뚝섬: "뚝섬",
  건대: "건대입구",
  건대입구: "건대입구",
  왕십리: "왕십리",
  옥수: "옥수",
  금호: "금호",
  홍대: "홍대",
  연남: "연남",
  합정: "합정",
  망원: "망원",
  한남: "한남",
  이태원: "이태원",
  잠실: "잠실",
  을지로: "을지로",
  익선동: "익선동",
  청계천: "을지로",
  충무로: "충무로",
  문래: "문래",
  서촌: "서촌",
  압구정: "압구정",
  청담: "청담",
  신사: "신사",
  삼성: "삼성",
  선릉: "선릉",
  판교: "판교",
  송리단길: "송파",
  송파: "송파",
  석촌: "석촌",
  상수: "상수",
  연희: "연희",
  공덕: "공덕",
  광화문: "광화문",
  종로: "종로",
};

const AREA_CLUSTER: Record<string, string> = {
  성수: "seongsu",
  서울숲: "seongsu",
  뚝섬: "seongsu",
  건대입구: "seongsu",
  왕십리: "seongsu",
  옥수: "seongsu",
  금호: "seongsu",
  홍대: "hongdae",
  연남: "hongdae",
  합정: "hongdae",
  망원: "hongdae",
  한남: "hannam",
  이태원: "hannam",
  잠실: "jamsil",
  을지로: "euljiro",
  익선동: "jongno",
  청계천: "euljiro",
  충무로: "euljiro",
  문래: "mullae",
  서촌: "seochon",
  압구정: "apgujeong",
  청담: "apgujeong",
  신사: "apgujeong",
  삼성: "gangnam",
  선릉: "gangnam",
  강남: "gangnam",
  판교: "pangyo",
  송파: "jamsil",
  석촌: "jamsil",
  상수: "hongdae",
  연희: "hongdae",
  공덕: "mapo",
  마포: "mapo",
  광화문: "jongno",
  종로: "jongno",
  안국: "jongno",
  북촌: "jongno",
  삼청: "jongno",
};

const CLUSTER_AREAS: Record<string, string[]> = {
  seongsu: ["성수", "서울숲", "왕십리", "건대입구", "뚝섬"],
  hongdae: ["홍대", "연남", "합정", "망원", "상수"],
  hannam: ["한남", "이태원", "해방촌"],
  jamsil: ["잠실", "송파", "석촌"],
  euljiro: ["을지로", "청계천", "충무로", "명동"],
  gangnam: ["강남", "삼성", "선릉"],
  apgujeong: ["압구정", "청담", "신사"],
  jongno: ["광화문", "종로", "북촌", "서촌", "익선동", "혜화"],
  mapo: ["공덕", "마포"],
  mullae: ["문래", "영등포"],
};

const AREA_NEARBY: Record<string, string[]> = {
  군산: ["전주", "익산"],
  전주: ["군산", "익산"],
  포천: ["가평", "남양주"],
  가평: ["춘천", "포천"],
  양평: ["가평"],
  제주: ["서귀포", "애월"],
  부산: ["해운대", "광안리"],
  여수: ["순천"],
  강릉: ["속초", "양양"],
  속초: ["강릉", "양양"],
  경주: ["포항"],
  을지로: ["익선동", "청계천", "충무로"],
  성수: ["서울숲", "왕십리", "성수"],
  홍대: ["연남", "합정", "상수"],
  잠실: ["송파", "석촌"],
  한남: ["이태원", "해방촌"],
  강남: ["삼성", "선릉"],
  압구정: ["청담", "신사"],
  판교: ["정자", "분당"],
};

const SCOPE_METERS: Record<DateAreaScope, number> = {
  core: 1200,
  walkable: 2200,
  nearby: 2800,
};
const ACTIVITY_IDS = new Set<DateActivityId>(DATE_ACTIVITY_OPTIONS.map(item => item.id));
const LABEL_TO_ACTIVITY = new Map(DATE_ACTIVITY_OPTIONS.map(item => [item.label, item.id]));
const CUISINE_REGEX: Record<DateCuisine, RegExp> = {
  한식: /한식|국밥|고기|갈비|삼겹|한우|분식|백반|찌개|구이/,
  일식: /일식|스시|초밥|라멘|우동|돈카츠|오마카세|이자카야/,
  중식: /중식|중국|마라|딤섬|짜장|짬뽕/,
  양식: /양식|파스타|피자|브런치|이탈리|프렌치|스테이크|와인/,
};

export const emptyDateBrief = (): AIPlannerState => ({
  activities: [],
  areas: [],
  region: "",
  regions: [],
  areaScope: null,
  requiredPlaces: [],
  excludedPlaces: [],
  cuisine: null,
  indoorPlay: null,
  pace: "balanced",
  stayKind: null,
  nights: 0,
  timeWindow: null,
  startTime: null,
  endTime: null,
  dateLabel: null,
  pinOrder: [],
  preserveExistingPlaces: true,
  addStop: false,
  intent: "create",
  pendingSlot: null,
  conversationNotes: [],
});

export function planDayYmd(state: Pick<AIPlannerState, "dateLabel">, now = new Date()) {
  const digits = String(state.dateLabel ?? "").replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return koreaTodayYmd(now);
}

export function isDateActivityId(value: string): value is DateActivityId {
  return ACTIVITY_IDS.has(value as DateActivityId);
}

export function activityIdFromLabel(label: string): DateActivityId | null {
  return LABEL_TO_ACTIVITY.get(label) ?? (isDateActivityId(label) ? label : null);
}

export function activityLabels(ids: DateActivityId[]) {
  return ids.map(id => DATE_ACTIVITY_OPTIONS.find(item => item.id === id)?.label ?? id);
}

export function uniqueStrings(values: Array<string | null | undefined>, max = 8) {
  return [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))].slice(0, max);
}

export function uniqueActivities(values: string[]) {
  return uniqueStrings(values).filter(isDateActivityId);
}

export function asCuisineChoice(value: unknown): DateCuisineChoice | null {
  if (value === "상관없음" || value === "any") return "any";
  return value === "한식" || value === "일식" || value === "중식" || value === "양식" ? value : null;
}

export function asTimeWindow(value: unknown): DateTimeWindow | null {
  const fromId = DATE_TIME_OPTIONS.find(item => item.id === value || item.label === value);
  return fromId?.id ?? null;
}

export function asAreaScope(value: unknown): DateAreaScope | null {
  const fromId = DATE_SCOPE_OPTIONS.find(item => item.id === value || item.label === value);
  return fromId?.id ?? null;
}

export function canonicalizeArea(name: string) {
  const compact = name.replace(/\s/g, "").replace(/역$/, "");
  return AREA_CANON[compact] ?? name.replace(/역$/, "");
}

function areaCluster(name: string) {
  return AREA_CLUSTER[canonicalizeArea(name)] ?? canonicalizeArea(name);
}

function clusterCount(areas: string[]) {
  return new Set(areas.map(areaCluster)).size;
}

export function needsAreaScope(state: AIPlannerState) {
  const areas = state.areas.length ? state.areas : state.regions;
  if (!areas.length || state.areaScope) return false;
  return clusterCount(areas) <= 1;
}

const VACATION_AREAS = new Set([
  "제주", "부산", "군산", "전주", "여수", "경주", "강릉", "속초", "가평", "춘천", "양양",
  "포천", "양평", "단양", "거제", "해운대", "광안리", "서귀포", "애월", "순천",
]);

export function isRainyRequest(text: string) {
  return /비\s*오|우천|비오는|장마|눈\s*오/.test(text);
}

export function isTravelArea(name: string) {
  return VACATION_AREAS.has(canonicalizeArea(name));
}

export function isTravelPlan(state: Pick<AIPlannerState, "stayKind" | "nights" | "areas" | "regions">) {
  if (state.stayKind === "overnight" || state.stayKind === "daytrip" || (state.nights || 0) > 0) return true;
  return selectedAreas(state as AIPlannerState).some(isTravelArea);
}

export function isSimpleLocalRequest(message: string) {
  const areas = extractAreasFromText(message);
  if (!areas.length) return false;
  const rest = areas
    .sort((a, b) => b.length - a.length)
    .reduce((text, area) => text.replace(new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), ""), message.replace(/\s/g, ""));
  return /^(?:에서|으로|로|에)?(?:데이트|여행|당일치기|1박2일|2박3일|코스|일정|추천|하고싶어|가려고|갈래|짜줘|놀고싶어|가고싶어|가고싶은데)*[!?~]*$/.test(rest);
}

export function areaScopeMeters(state: AIPlannerState) {
  const areas = state.areas.length ? state.areas : state.regions;
  if (isTravelPlan(state)) return state.areaScope === "core" ? 6000 : 15000;
  if (clusterCount(areas) > 1) return 6000;
  return SCOPE_METERS[state.areaScope ?? "walkable"];
}

export function selectedAreas(state: AIPlannerState) {
  return uniqueStrings((state.areas.length ? state.areas : state.regions).map(canonicalizeArea), 3);
}

export function nearbyAreaSuggestions(state: AIPlannerState) {
  const current = selectedAreas(state);
  const nearby = current.flatMap(area => AREA_NEARBY[canonicalizeArea(area)] ?? []);
  const extras = DATE_AREA_OPTIONS.filter(area => !current.includes(area));
  return uniqueStrings([...nearby, ...extras].filter(area => !current.includes(area)), 6);
}

export function areaMentionedInText(area: string, message: string) {
  const compact = message.replace(/\s/g, "");
  const needle = canonicalizeArea(area).replace(/\s/g, "");
  return needle.length >= 2 && compact.includes(needle);
}

export const DATE_LANDMARKS = ["청계천", "한강", "남산", "광화문", "덕수궁", "경복궁", "북촌"] as const;

export function isAdditiveRequest(message: string) {
  return /추가|넣어|들러|경유|포함|갈\s*수|있나|도\s*가|더함|한 곳 더/.test(message);
}

export function isExclusiveCrawl(state: Pick<AIPlannerState, "conversationNotes"> | string) {
  const blob = typeof state === "string" ? state : state.conversationNotes.join(" ");
  return /(?:카페|커피|디저트|맛집|식당|전시|갤러리)\s*(?:투어|위주)|커피만\s|밥만\s|(?:카페|전시)만\s*(?:가자|갈게|돌|보)/.test(blob);
}

export function groundedAreas(message: string, previous: AIPlannerState | undefined, proposed: string[]) {
  const extracted = extractAreasFromText(message);
  const mentioned = proposed.filter(area => areaMentionedInText(area, message));
  const found = uniqueStrings([...extracted, ...mentioned], 3);
  const previousAreas = previous ? selectedAreas(previous) : [];
  const switching = /(?:다른|말고|대신)\s*(?:곳|도시|동네|지역)|처음부터|새로|전부\s*바꿔/.test(message);
  if (switching) return found;
  if (found.length && previousAreas.length) {
    const sameCluster = found.every(area => previousAreas.some(prev => areaCluster(area) === areaCluster(prev)));
    if (isAdditiveRequest(message) || sameCluster) return uniqueStrings([...previousAreas, ...found], 3);
    return found;
  }
  if (found.length) return found;
  return previousAreas;
}

export function openSearchPool(hint: {
  message?: string;
  areas?: string[];
  stayKind?: DateStayKind | null;
  timeWindow?: DateTimeWindow | null;
  notes?: string[];
}): DateActivityId[] {
  const blob = `${hint.message ?? ""} ${(hint.notes ?? []).join(" ")}`;
  if (isRainyRequest(blob)) return ["indoor", "exhibit", "cafe", "meal"];
  const areas = (hint.areas ?? []).map(canonicalizeArea);
  if (hint.timeWindow === "night") return ["meal", "nightview", "cafe"];
  if (hint.timeWindow === "evening") return ["meal", "cafe", "walk"];
  if (hint.stayKind === "overnight" || hint.stayKind === "daytrip" || areas.some(isTravelArea)) {
    return ["walk", "meal"];
  }
  if (!areas.length && hint.stayKind !== "date") return ["cafe", "meal", "walk", "exhibit"];
  return ["cafe", "meal", "walk", "exhibit"];
}

export function dateSpine(state: AIPlannerState): DateActivityId[] {
  const named = uniqueActivities(state.activities);
  const areas = selectedAreas(state);
  const blob = state.conversationNotes.join(" ");
  if (isExclusiveCrawl(state) && named.length) return named.slice(0, 3);
  if (isRainyRequest(blob)) return uniqueActivities(["indoor", "cafe", "meal", ...named]).slice(0, 3);
  if (isTravelPlan(state)) {
    return uniqueActivities(["walk", "meal", ...named]).slice(0, 4);
  }
  if (state.timeWindow === "night") {
    const extra = named.find(item => item !== "meal") ?? "nightview";
    return uniqueActivities(["meal", extra === "cafe" || extra === "nightview" ? extra : "cafe"]);
  }
  if (state.timeWindow === "evening") {
    const extra = named.find(item => item === "cafe" || item === "walk" || item === "exhibit" || item === "indoor" || item === "nightview")
      ?? (areas.some(area => /한강|여의도|서울숲/.test(area)) ? "walk" : "cafe");
    return uniqueActivities(["meal", extra]);
  }
  const extra = named.find(item => item !== "meal" && item !== "cafe")
    ?? areaDateVibe(areas).find(item => item !== "meal" && item !== "cafe");
  return extra
    ? uniqueActivities(["meal", "cafe", extra]).slice(0, 3)
    : uniqueActivities(["meal", "cafe"]);
}

export function inferSituationActivities(hint: {
  message?: string;
  areas?: string[];
  stayKind?: DateStayKind | null;
  timeWindow?: DateTimeWindow | null;
  notes?: string[];
}): DateActivityId[] {
  const message = hint.message ?? "";
  const named = extractActivitiesFromText(message);
  if (named.length) return named;
  const blob = `${message} ${(hint.notes ?? []).join(" ")}`;
  if (/카페\s*(?:투어|만|위주)|커피만/.test(blob)) return ["cafe"];
  if (/맛집\s*(?:투어|만)|밥만/.test(blob)) return ["meal"];
  if (isRainyRequest(blob)) return ["indoor", "exhibit", "cafe", "meal"];
  const areas = (hint.areas ?? []).map(canonicalizeArea);
  if (!areas.length && hint.stayKind !== "overnight" && hint.stayKind !== "daytrip") {
    if (hint.timeWindow === "night") return ["meal", "nightview"];
    return [];
  }
  if (hint.timeWindow === "night") return ["meal", "nightview"];
  if (hint.timeWindow === "evening") {
    if (areas.some(area => /한강|여의도|서울숲/.test(area))) return ["meal", "walk"];
    return ["meal", "cafe"];
  }
  if (hint.stayKind === "overnight" || hint.stayKind === "daytrip" || areas.some(isTravelArea)) {
    return ["walk", "meal"];
  }
  const vibe = areaDateVibe(areas);
  if (vibe.length) return vibe;
  if (!areas.length && !hint.stayKind && !hint.timeWindow) return [];
  return ["meal", "cafe"];
}

function areaDateVibe(areas: string[]): DateActivityId[] {
  for (const area of areas) {
    const key = canonicalizeArea(area);
    const cluster = areaCluster(key);
    if (cluster === "seongsu" || /성수|서울숲|뚝섬/.test(key)) return ["cafe", "walk", "exhibit"];
    if (cluster === "euljiro" || cluster === "jongno") return ["meal", "exhibit", "cafe"];
    if (cluster === "hongdae") return ["cafe", "meal"];
    if (cluster === "hannam" || cluster === "apgujeong" || cluster === "gangnam") return ["meal", "cafe"];
    if (cluster === "jamsil") return ["walk", "meal", "cafe"];
    if (/한강|여의도/.test(key)) return ["walk", "cafe"];
  }
  return [];
}

export function isThinCafeGuess(activities: DateActivityId[], message: string) {
  return activities.length === 1 && activities[0] === "cafe" && !/카페|커피|디저트/.test(message);
}

export function isUnnamedGlobalMix(activities: DateActivityId[], message: string) {
  if (extractActivitiesFromText(message).length) return false;
  const set = new Set(activities);
  return set.has("meal") && set.has("walk") && set.has("exhibit");
}

export function fitsWantedActivities(candidate: DiscoverCandidate, wanted: DateActivityId[]) {
  if (!wanted.length) return true;
  return wanted.some(activity => matchesActivity(candidate, activity));
}

export function missingWantedSlots(have: Iterable<string>, wanted: DateActivityId[]) {
  const slots = new Set(have);
  return wanted.filter(activity => {
    if (activity === "nightview") return !slots.has("nightview") && !slots.has("walk");
    return !slots.has(activity);
  });
}

export function rescueSearchQueries(region: string, wanted: DateActivityId[]) {
  const slots = wanted.length ? wanted : (["cafe", "meal", "walk"] as DateActivityId[]);
  const queries: string[] = [];
  if (slots.includes("cafe")) queries.push(`${region} 카페`);
  if (slots.includes("meal")) queries.push(`${region} 식당`);
  if (slots.includes("walk")) queries.push(`${region} 공원`);
  if (slots.includes("exhibit")) queries.push(`${region} 전시`);
  if (slots.includes("indoor")) queries.push(`${region} 방탈출`);
  if (slots.includes("nightview")) queries.push(`${region} 야경`);
  return queries;
}

export function groundedActivities(
  message: string,
  previous: AIPlannerState | undefined,
  proposed: DateActivityId[] = [],
  _context?: Pick<AIPlannerState, "areas" | "stayKind" | "timeWindow" | "conversationNotes">,
): DateActivityId[] {
  const extracted = extractActivitiesFromText(message);
  const previousActivities = previous?.activities ?? [];
  const switching = /처음부터|새로|전부\s*바꿔|리셋/.test(message);
  const editingCourse = /바꿔|교체|변경|빼줘|제외|한 곳/.test(message);
  if (editingCourse && !switching) return previousActivities;
  if (extracted.length) {
    const named = uniqueActivities(proposed.filter(id => extracted.includes(id)));
    const next = named.length ? named : extracted;
    if (!switching && previousActivities.length && isAdditiveRequest(message)) {
      return uniqueActivities([...previousActivities, ...next]);
    }
    return next;
  }
  if (switching) return [];
  if (previousActivities.length) return previousActivities;
  return [];
}

export function expandedSearchRegions(state: AIPlannerState) {
  const selected = selectedAreas(state);
  if (!state.areaScope || state.areaScope === "core") return selected;
  return uniqueStrings([...selected, ...selected.flatMap(area => CLUSTER_AREAS[areaCluster(area)] ?? [])], 6);
}

/**
 * Only the destination is truly required. Stay length is asked for travel
 * destinations (제주, 부산, 군산...), where a day trip and an overnight are
 * different plans; a Seoul neighborhood defaults to a one-day date so the
 * chat does not turn into a form.
 */
export function missingSlot(state: AIPlannerState | undefined): DateIntakeSlot | null {
  if (!state?.areas.length && !state?.regions.length) return "area";
  if (!state.stayKind && selectedAreas(state).some(isTravelArea)) return "span";
  return null;
}

export function discoveryActivities(state: AIPlannerState): DateActivityId[] {
  const pool = openSearchPool({
    message: state.conversationNotes.at(-1) ?? "",
    areas: selectedAreas(state),
    stayKind: state.stayKind,
    timeWindow: state.timeWindow,
    notes: state.conversationNotes,
  });
  if (isExclusiveCrawl(state) && state.activities.length) return state.activities;
  if (state.activities.length) return uniqueActivities([...state.activities, ...pool]);
  return pool;
}

export function applyDateDefaults(state: AIPlannerState): AIPlannerState {
  return {
    ...state,
    stayKind: state.stayKind ?? "date",
    areaScope: state.areaScope ?? "nearby",
    timeWindow: state.timeWindow ?? "any",
    cuisine: state.cuisine ?? (state.activities.includes("meal") ? "any" : null),
    indoorPlay: state.indoorPlay ?? (state.activities.includes("indoor") ? "상관없음" : null),
  };
}

export function briefHeadline(state: AIPlannerState) {
  const activities = activityLabels(state.activities);
  const areas = state.areas.length ? state.areas : state.regions;
  if (!activities.length && !areas.length) return "";
  if (activities.length && areas.length) return `${areas.join(" · ")} · ${activities.join(", ")}`;
  return [...areas, ...activities].join(" · ");
}

export function briefChips(state: AIPlannerState) {
  const time = DATE_TIME_OPTIONS.find(item => item.id === state.timeWindow);
  const cuisine = DATE_CUISINE_OPTIONS.find(item => item.id === state.cuisine);
  return [
    ...(state.areas.length ? state.areas : state.regions),
    ...activityLabels(state.activities),
    time && time.id !== "any" ? time.label : "",
    cuisine && cuisine.id !== "any" ? cuisine.label : "",
    state.areaScope === "core" ? "이 동네만" : state.areaScope === "nearby" && clusterCount(state.areas.length ? state.areas : state.regions) <= 1 ? "주변 허용" : "",
    state.indoorPlay && state.indoorPlay !== "상관없음" ? state.indoorPlay : "",
  ].filter(Boolean);
}

export function withAreas(state: AIPlannerState, areas: string[]): AIPlannerState {
  const next = uniqueStrings(areas.map(canonicalizeArea), 3);
  return {
    ...state,
    areas: next,
    regions: next,
    region: next[0] ?? "",
    areaScope: clusterCount(next) > 1 ? "nearby" : state.areaScope,
  };
}

export function withActivities(state: AIPlannerState, labels: string[]): AIPlannerState {
  return { ...state, activities: uniqueActivities(labels.map(label => activityIdFromLabel(label) ?? "")) };
}

export function withStayKind(state: AIPlannerState, label: string): AIPlannerState {
  const matched = DATE_SPAN_OPTIONS.find(item => item.label === label);
  if (!matched) return state;
  return { ...state, stayKind: matched.id, nights: matched.nights };
}

export function withTimeWindow(state: AIPlannerState, label: string): AIPlannerState {
  const option = DATE_TIME_OPTIONS.find(item => item.label === label || item.id === label);
  if (!option) return state;
  return { ...state, timeWindow: option.id, startTime: option.startTime, endTime: option.endTime };
}

export function withAreaScope(state: AIPlannerState, label: string): AIPlannerState {
  const scope = asAreaScope(label);
  return scope ? { ...state, areaScope: scope } : state;
}

export function withCuisine(state: AIPlannerState, label: string): AIPlannerState {
  const cuisine = asCuisineChoice(label);
  return cuisine ? { ...state, cuisine } : state;
}

export function extractActivitiesFromText(message: string): DateActivityId[] {
  const found: DateActivityId[] = [];
  for (const option of DATE_ACTIVITY_OPTIONS) {
    if (option.id === "indoor" && /실내\s*데이트/.test(message) && !/방탈출|보드게임|볼링|오락실|만화카페|VR|노래방|놀거리/.test(message)) continue;
    if (message.includes(option.label)) found.push(option.id);
  }
  if (/카페|커피|디저트|베이커리/.test(message)) found.push("cafe");
  if (/(?:저녁|점심|아침)\s*(?:먹|식사)|식사|밥|맛집|음식|파스타|라멘|브런치/.test(message)) found.push("meal");
  if (/산책|공원|숲길|청계천|남산|걷/.test(message)) found.push("walk");
  if (/전시|미술관|갤러리|박물관|미디어아트/.test(message)) found.push("exhibit");
  if (/놀거리|방탈출|보드게임|볼링|오락실|만화카페|VR|노래방/.test(message)) found.push("indoor");
  if (/야경|전망대|루프탑|야경맛집/.test(message)) found.push("nightview");
  return uniqueActivities(found);
}

export function extractAreasFromText(message: string) {
  const known = [...KNOWN_AREAS]
    .sort((a, b) => b.length - a.length)
    .filter(area => message.includes(area));
  const travel = [...message.matchAll(/([가-힣]{2,8})\s*(?:여행|에서|으로|쪽)/g)]
    .map(match => match[1])
    .filter(name => !AREA_STOPWORDS.has(name));
  const suffixed = [...message.matchAll(/([가-힣]{2,12}?(?:역|동|구|시))(?=\s|에서|근처|주변|으로|가서|$)/g)]
    .map(match => match[1].replace(/(?:역|시)$/, ""));
  return uniqueStrings([...known, ...travel, ...suffixed].map(canonicalizeArea), 3);
}

export function extractAreaScope(message: string): DateAreaScope | null {
  const fromLabel = DATE_SCOPE_OPTIONS.find(item => message.includes(item.label));
  if (fromLabel) return fromLabel.id;
  if (/주변에서만|이 동네만|안에서만|여기서만|그 동네만/.test(message)) return "core";
  if (/한 정거장|조금 멀어도|주변도 괜찮|주변도 허용|조금 넓게/.test(message)) return "nearby";
  if (/걸어갈|도보권|주변까지 열/.test(message)) return "walkable";
  return null;
}

export function extractPlacesFromText(message: string) {
  const landmarks = DATE_LANDMARKS.filter(name => message.includes(name));
  const named = [...message.matchAll(/([가-힣A-Za-z0-9]{2,18}?(?:공원|미술관|박물관|전시관|시장|식당|카페|호수|수목원|계곡|해변|청계천))(?=\s|에서|으로|가고|들(?:러|렀)|빼|제외|도|$)/g)]
    .map(match => match[1]);
  return uniqueStrings([...landmarks, ...named], 4);
}

export function extractCuisine(message: string): DateCuisineChoice | null {
  const specific = (["한식", "일식", "중식", "양식"] as const).find(item => message.includes(item));
  if (specific) return specific;
  const fromDish = (["한식", "일식", "중식", "양식"] as const).find(item => CUISINE_REGEX[item].test(message));
  if (fromDish) return fromDish;
  if (/(?:음식|식사|메뉴|밥).*(상관없|아무거나)|상관없.*(?:음식|식사|메뉴)/.test(message)) return "any";
  return null;
}

export function extractStay(message: string): { stayKind: DateStayKind; nights: number } | null {
  if (/2박\s*3일|이틀\s*자|2박/.test(message)) return { stayKind: "overnight", nights: 2 };
  if (/1박\s*2일|하룻밤|하루\s*자|1박/.test(message)) return { stayKind: "overnight", nights: 1 };
  if (/당일치기|당일\s*코스|하루\s*만|당일로/.test(message)) return { stayKind: "daytrip", nights: 0 };
  if (/데이트/.test(message) && !/여행/.test(message)) return { stayKind: "date", nights: 0 };
  const areas = extractAreasFromText(message);
  if (
    areas.length
    && !areas.some(isTravelArea)
    && /(?:에서|갈래|고\s*싶|놀자|코스|일정)/.test(message)
    && !/여행|1박|2박|당일치기/.test(message)
  ) {
    return { stayKind: "date", nights: 0 };
  }
  return null;
}

export function extractTimeWindow(message: string): DateTimeWindow | null {
  const byLabel = DATE_TIME_OPTIONS.find(item => item.id !== "any" && message.includes(item.label));
  if (byLabel) return byLabel.id;
  if (/아무때|시간\s*상관|언제든/.test(message)) return "any";
  if (/밤\s*분위기|밤늦게|밤\s*데이트|밤부터/.test(message)) return "night";
  const mealTalk = /먹|식사|밥|맛집/.test(message) && !/(부터|시작|쯤)/.test(message);
  if ((/저녁부터|저녁에|저녁때|저녁\s*데이트/.test(message) || /오후\s*(?:6|7|8|9)/.test(message)) && !mealTalk) return "evening";
  if (/저녁부터|저녁에\s*시작/.test(message)) return "evening";
  if (/오후부터|낮에|낮\s*데이트/.test(message)) return "afternoon";
  if (/오후|점심/.test(message) && !mealTalk) return "afternoon";
  return null;
}

export function extractIndoorPlay(message: string) {
  if (/상관없|아무거나|알아서/.test(message)) return "상관없음";
  return DATE_INDOOR_OPTIONS.find(item => item !== "상관없음" && message.includes(item)) ?? null;
}

export function indoorSearchQueries(indoorPlay: string | null) {
  if (indoorPlay && indoorPlay !== "상관없음") {
    if (indoorPlay === "VR 체험") return ["VR카페"];
    if (indoorPlay === "보드게임") return ["보드게임카페"];
    return [indoorPlay];
  }
  return ["방탈출", "보드게임카페", "볼링"];
}

export type DateSearchIntent = {
  region: string;
  category?: PlaceCategoryId;
  query?: string;
};

export function activitySearchIntents(state: AIPlannerState): Array<{ category?: PlaceCategoryId; query?: string }> {
  const intents: Array<{ category?: PlaceCategoryId; query?: string }> = [];
  const mealQuery = state.cuisine && state.cuisine !== "any" ? state.cuisine : undefined;
  const trip = isTravelPlan(state);
  for (const activity of discoveryActivities(state)) {
    if (activity === "cafe") intents.push({ category: "cafe" });
    else if (activity === "meal") {
      if (mealQuery) intents.push({ category: "restaurant", query: mealQuery });
      intents.push({ category: "restaurant" });
    }
    else if (activity === "walk") {
      intents.push({ category: "nature" });
      if (trip) {
        intents.push({ category: "tourist" });
        intents.push({ query: "관광지" });
      }
    }
    else if (activity === "exhibit") {
      intents.push({ category: "photo" });
      if (!trip) intents.push({ category: "photo", query: "전시" });
    }
    else if (activity === "indoor") {
      for (const query of indoorSearchQueries(state.indoorPlay)) intents.push({ query });
    } else if (activity === "nightview") {
      intents.push({ query: "전망대" });
      intents.push({ query: "루프탑" });
    }
  }
  return intents;
}

export function searchIntents(state: AIPlannerState): DateSearchIntent[] {
  const regions = selectedAreas(state);
  return regions.flatMap(region => activitySearchIntents(state).map(intent => ({ region, ...intent })));
}

export function matchesTerm(candidate: DiscoverCandidate, term: string) {
  const candidateName = candidate.name.replace(/\s/g, "");
  const normalized = term.replace(/\s/g, "");
  return normalized.length >= 2 && (candidateName.includes(normalized) || normalized.includes(candidateName));
}

const INDOOR_TYPE_REGEX: Record<string, RegExp> = {
  방탈출: /방탈출/,
  보드게임: /보드게임|보드카페/,
  볼링: /볼링/,
  오락실: /오락실/,
  만화카페: /만화카페|웹툰카페/,
  "VR 체험": /VR|브이알/,
};

export function candidateDetails(candidate: DiscoverCandidate) {
  return `${candidate.categoryLabel} ${candidate.detailedCategory ?? ""} ${candidate.name}`;
}

export function matchesIndoorType(candidate: DiscoverCandidate, indoorPlay: string | null) {
  if (!indoorPlay || indoorPlay === "상관없음") return matchesActivity(candidate, "indoor");
  return (INDOOR_TYPE_REGEX[indoorPlay] ?? new RegExp(indoorPlay.replace(/\s/g, ""))).test(candidateDetails(candidate));
}

export function matchesActivity(candidate: DiscoverCandidate, activity: DateActivityId) {
  const details = candidateDetails(candidate);
  if (activity === "cafe") return candidate.category === "cafe" || candidate.kakaoCategoryGroupCode === "CE7";
  if (activity === "meal") return candidate.category === "restaurant" || candidate.kakaoCategoryGroupCode === "FD6";
  if (activity === "walk") return candidate.category === "nature" || candidate.category === "tourist" || /공원|한강|숲|수목원|산책|청계천|남산|계곡|호수|해변|관광/.test(details);
  if (activity === "exhibit") return candidate.category === "festival" || candidate.kakaoCategoryGroupCode === "CT1" || /전시|미술관|박물관|갤러리|축제/.test(details);
  if (activity === "indoor") return /볼링장|방탈출|보드게임|보드카페|오락실|만화카페|노래방|VR카페|VR/.test(details);
  return /야경|전망대|루프탑/.test(details) || (/한강공원/.test(details) && candidate.category === "nature");
}

export function matchesCuisine(candidate: DiscoverCandidate, cuisine: DateCuisineChoice | null) {
  if (!cuisine || cuisine === "any") return true;
  const details = `${candidate.name} ${candidate.categoryLabel} ${candidate.detailedCategory ?? ""}`;
  return details.includes(cuisine) || CUISINE_REGEX[cuisine].test(details);
}

export function slotQuestion(slot: DateIntakeSlot, state?: AIPlannerState) {
  if (slot === "activity") {
    return {
      message: "어떤 데이트를 할까요? 고른 활동에 맞춰 동선을 짭니다.",
      options: DATE_ACTIVITY_OPTIONS.map(item => item.label),
      multiple: true,
    };
  }
  if (slot === "area") {
    const last = state?.conversationNotes.at(-1) ?? "";
    const travel = /여행|떠나|놀러/.test(last);
    return {
      message: travel
        ? "어디로 떠날까요? 도시나 동네만 고르면 됩니다."
        : "어디로 갈까요? 도시나 동네만 고르면 됩니다.",
      options: [...DATE_AREA_OPTIONS],
      multiple: false,
    };
  }
  if (slot === "scope") {
    const where = (state ? selectedAreas(state) : []).slice(0, 2).join(" · ") || "그 동네";
    return {
      message: `${where}는 이 동네 안에서만 볼까요, 걸어갈 주변까지 열까요?`,
      options: DATE_SCOPE_OPTIONS.map(item => item.label),
      multiple: false,
    };
  }
  if (slot === "span") {
    return {
      message: "데이트, 당일치기, 숙박 중 어떤 일정인가요? 길이에 맞춰 몇 곳을 이을지 정합니다.",
      options: DATE_SPAN_OPTIONS.map(item => item.label),
      multiple: false,
    };
  }
  if (slot === "time") {
    return {
      message: "몇 시부터 시작할까요? 오후는 서너 곳, 저녁은 두세 곳으로 맞춥니다.",
      options: DATE_TIME_OPTIONS.map(item => item.label),
      multiple: false,
    };
  }
  if (slot === "cuisine") {
    return {
      message: "식사는 한식, 일식, 중식, 양식 중 고르면 됩니다. 모르면 상관없음을 누르세요.",
      options: DATE_CUISINE_OPTIONS.map(item => item.label),
      multiple: false,
    };
  }
  return {
    message: "실내 활동은 무엇으로 할까요? 모르면 상관없음을 누르세요.",
    options: [...DATE_INDOOR_OPTIONS],
    multiple: false,
  };
}

export function courseSize(state: AIPlannerState) {
  const nights = Math.max(0, Math.min(2, state.nights || 0));
  const days = state.stayKind === "overnight" || nights > 0 ? Math.max(2, nights + 1) : 1;
  const size = days > 1
    ? { min: 2 * days, max: 4 * days, days }
    : state.stayKind === "daytrip"
      ? { min: 3, max: 5, days: 1 }
      : (state.timeWindow === "evening" || state.timeWindow === "night")
        ? { min: 2, max: 3, days: 1 }
        : { min: 2, max: 4, days: 1 };
  if (!state.addStop || !state.preserveExistingPlaces || state.pinOrder.length < 2) return size;
  const need = Math.min(8, state.pinOrder.length + 1);
  return {
    min: Math.max(size.min, need),
    max: Math.max(size.max, need),
    days: size.days,
  };
}

export function assumedTimeWindow(state: AIPlannerState) {
  if (state.stayKind === "overnight" || (state.nights || 0) > 0) {
    return { startTime: "11:00", endTime: "21:00", specified: true, window: state.timeWindow };
  }
  if (state.stayKind === "daytrip") {
    return { startTime: "11:00", endTime: "20:00", specified: true, window: state.timeWindow ?? "any" };
  }
  const chosen = DATE_TIME_OPTIONS.find(item => item.id === state.timeWindow);
  if (chosen?.startTime) {
    return { startTime: chosen.startTime, endTime: chosen.endTime || "21:00", specified: true, window: chosen.id };
  }
  if (state.startTime) {
    return { startTime: state.startTime, endTime: state.endTime || "21:00", specified: true, window: state.timeWindow };
  }
  if (state.activities.includes("nightview") || state.timeWindow === "night") {
    return { startTime: "17:30", endTime: "22:00", specified: false, window: "night" as DateTimeWindow };
  }
  return { startTime: "14:00", endTime: "20:00", specified: false, window: state.timeWindow };
}
