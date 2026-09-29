import type { DiscoverCandidate, PlaceCategoryId } from "@/features/places/types/place";
import type { ExperienceBlock, ExperiencePlan, ExperienceQuality } from "./experiencePlan";

export type ResearchNeed = {
  id: string;
  dayIndex?: number;
  experienceBlockId?: string;
  kind: "venue" | "evidence" | "relation";
  purpose: string;
  category?: PlaceCategoryId;
  geographicFocus?: string;
  qualities: string[];
  evidenceNeeded: string[];
  supportingRole?: "primary" | "meal" | "cafe" | "rest" | "shopping";
  /** Search coverage priority only; never an itinerary hard constraint. */
  priority: "required" | "important" | "optional";
};
export type ResearchUnresolved = { needId?: string; reason: string };
export type ResearchPlan = { needs: ResearchNeed[]; unresolved: ResearchUnresolved[];
  source: "llm" | "legacy_fallback" };
export type ResearchCoverage = { needId: string; status: "unsearched" | "insufficient" | "sufficient";
  candidateCount: number; evidenceCoverage: number; missingEvidence: string[] };
export type ResearchPlanMode = "off" | "shadow" | "active";

export function getResearchPlanMode(): ResearchPlanMode {
  const value = process.env.DATE_RESEARCH_PLAN_MODE;
  return value === "shadow" || value === "active" ? value : "off";
}

export function researchSearchAuthority(mode: ResearchPlanMode, plan: ResearchPlan | null, hadExperiencePlan = false) {
  if (mode !== "active") return { active: false, fallbackReason: null };
  if (!plan) return { active: false, fallbackReason: hadExperiencePlan
    ? "invalid_research_plan" : "missing_experience_plan" };
  if (!validateResearchPlan(plan)) return { active: false, fallbackReason: "invalid_research_plan" };
  return { active: true, fallbackReason: null };
}

const categoryTerms: Array<[RegExp, PlaceCategoryId, string]> = [
  [/카페|커피|디저트|베이커리|cafe/i, "cafe", "카페"],
  [/식사|음식|식당|맛집|레스토랑|파스타|브런치|meal/i, "restaurant", "식당"],
  [/축제|페스티벌|지역\s*행사|festival/i, "festival", "축제"],
  [/쇼핑|아울렛|백화점|시장|shopping/i, "tourist", "쇼핑"],
  [/체험|공방|원데이\s*클래스|액티비티|레포츠/i, "tourist", "체험"],
  [/전시|미술관|박물관|갤러리|exhibit/i, "photo", "전시"],
  [/해변|공원|산책|자연|숲|walk/i, "nature", "명소"],
  [/공연|영화|극장|performance|movie/i, "photo", "공연장"],
  [/숙소|호텔|stay/i, "stay", "숙소"],
];
const qualityEvidence: Record<string, string[]> = {
  aesthetic: ["space", "interior", "architecture", "view"],
  atmosphere: ["space", "interior", "ambience"],
  quiet: ["noise", "crowd", "seating", "space"],
  scenic: ["view", "terrace", "rooftop", "window"],
  view: ["view", "terrace", "rooftop", "window"],
  romantic: ["space", "ambience"],
  spacious: ["seating", "space"],
  traditional: ["architecture", "interior"],
  hanok: ["architecture", "interior"],
  dessert: ["menu"], value_for_money: ["menu", "price"], local_feel: [],
};
const unique = (values: string[]) => [...new Set(values)];
const qualityNames = (qualities: ExperienceQuality[]) => unique(qualities.map(item => item.dimension));
const evidenceFor = (qualities: string[]) => unique(qualities.flatMap(value => qualityEvidence[value] ?? []));

function categoryFor(block: ExperienceBlock): { category: PlaceCategoryId; queryTerm: string } {
  const text = `${block.primaryExperience} ${block.purpose}`;
  const match = categoryTerms.map(([pattern, category, queryTerm]) => ({ index: text.search(pattern), category, queryTerm }))
    .filter(item => item.index >= 0).sort((a, b) => a.index - b.index)[0];
  const category = match?.category ?? "tourist";
  const cuisine = category === "restaurant"
    ? /파스타|한식|일식|중식|양식|초밥|스시|브런치|해산물|바비큐|비건/.exec(text)?.[0] : null;
  return { category, queryTerm: cuisine ? `${cuisine} 식당` : match?.queryTerm ?? "관광지" };
}

/** The model's experience blocks choose the search units. This adapter never
 * introduces a meal/cafe/walk spine or an actual venue identity. */
export function buildResearchPlan(plan: ExperiencePlan): ResearchPlan {
  const needs: ResearchNeed[] = [];
  const remainingExplicit = new Set(plan.requiredElements);
  for (const day of plan.days) for (const [index, block] of day.experienceBlocks.entries()) {
    const blockId = `day-${day.dayIndex}-block-${index}`;
    const focus = day.geographicFocus?.trim() || undefined;
    const { category, queryTerm } = categoryFor(block);
    const correspondingActivity = category === "cafe" ? "cafe" : category === "restaurant" ? "meal"
      : category === "nature" ? "walk" : category === "photo" ? "exhibit" : null;
    const explicitlyRequired = correspondingActivity != null && remainingExplicit.has(correspondingActivity as ExperiencePlan["requiredElements"][number]);
    if (explicitlyRequired) remainingExplicit.delete(correspondingActivity as ExperiencePlan["requiredElements"][number]);
    const applies = (quality: ExperienceQuality) => quality.category === "any"
      || quality.category === "cafe" && category === "cafe"
      || quality.category === "meal" && category === "restaurant";
    const qualities = qualityNames([...block.qualitativeNeeds.filter(applies),
      ...plan.qualitativeNeeds.filter(quality => quality.source === "approved_semantic" && applies(quality))]);
    needs.push({ id: `${blockId}-venue`, dayIndex: day.dayIndex, experienceBlockId: blockId,
      kind: "venue", purpose: `${queryTerm} 방문 경험`, category,
      geographicFocus: focus, qualities, evidenceNeeded: evidenceFor(qualities),
      supportingRole: "primary", priority: index === 0 || explicitlyRequired ? "required" : "important" });
    if (qualities.length) needs.push({ id: `${blockId}-evidence`, dayIndex: day.dayIndex,
      experienceBlockId: blockId, kind: "evidence", purpose: `${queryTerm}의 질적 근거`,
      category, geographicFocus: focus, qualities, evidenceNeeded: evidenceFor(qualities),
      supportingRole: "primary", priority: "important" });
    for (const support of block.supportingNeeds.filter((item, itemIndex, all) => all.indexOf(item) === itemIndex)) {
      const supportCategory: PlaceCategoryId | undefined = support === "meal" ? "restaurant"
        : support === "cafe" ? "cafe" : support === "shopping" ? "tourist" : undefined;
      needs.push({ id: `${blockId}-${support}`, dayIndex: day.dayIndex,
        experienceBlockId: blockId, kind: "relation",
        purpose: `같은 방문 경험 내부 또는 인접 권역의 ${support}`,
        category: supportCategory, geographicFocus: focus, qualities: [], evidenceNeeded: [],
        supportingRole: support, priority: support === "rest" ? "optional" : "important" });
    }
  }
  return { needs, unresolved: [], source: "llm" };
}

export function tryBuildResearchPlan(plan: ExperiencePlan | null | undefined): ResearchPlan | null {
  if (!plan) return null;
  try {
    const research = buildResearchPlan(plan);
    if (!validateResearchPlan(research)) return null;
    if (plan.qualitativeNeeds.some(quality => quality.source === "explicit_user"
      && !research.needs.some(need => need.kind === "venue" && need.qualities.includes(quality.dimension)
        && (quality.category === "any" || quality.category === "cafe" && need.category === "cafe"
          || quality.category === "meal" && need.category === "restaurant")))) return null;
    return research;
  } catch { return null; }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function validateResearchPlan(raw: unknown): raw is ResearchPlan {
  if (!isRecord(raw) || !["llm", "legacy_fallback"].includes(String(raw.source))
    || !Array.isArray(raw.unresolved) || raw.unresolved.some(item => !isRecord(item)
      || typeof item.reason !== "string" || item.reason.length > 160)
    || !Array.isArray(raw.needs) || !raw.needs.length || raw.needs.length > 32) return false;
  const ids = new Set<string>();
  for (const need of raw.needs) {
    if (!isRecord(need) || typeof need.id !== "string" || !need.id || ids.has(need.id)
      || !["venue", "evidence", "relation"].includes(String(need.kind))
      || !["required", "important", "optional"].includes(String(need.priority))
      || typeof need.purpose !== "string" || !need.purpose || need.purpose.length > 160
      || !Array.isArray(need.qualities) || !Array.isArray(need.evidenceNeeded)
      || need.qualities.some(value => typeof value !== "string" || !Object.hasOwn(qualityEvidence, value))
      || need.evidenceNeeded.some(value => typeof value !== "string" || !Object.hasOwn(evidencePattern, value))
      || need.category != null && !["restaurant", "cafe", "nature", "photo", "book", "tourist", "festival", "stay"].includes(String(need.category))
      || need.geographicFocus != null && (typeof need.geographicFocus !== "string"
        || need.geographicFocus.length > 80 || !need.geographicFocus.trim())
      || typeof need.geographicFocus === "string"
        && /카페|식당|레스토랑|아울렛|백화점|호텔|리조트|미술관|박물관|쇼핑몰|공연장/.test(need.geographicFocus)
      || need.dayIndex != null && (!Number.isInteger(need.dayIndex) || (need.dayIndex as number) < 0)
      || need.experienceBlockId != null && typeof need.experienceBlockId !== "string"
      || need.kind === "venue" && !need.category
      || /(?:kakao|tourapi|candidate|venue):[^\s]+/i.test(JSON.stringify(need))) return false;
    ids.add(need.id);
  }
  return true;
}

export function researchSearchIntents(plan: ResearchPlan, defaultRegion: string) {
  const rows = plan.needs.filter(need => need.kind === "venue" || need.kind === "relation" && need.category)
    .sort((a, b) => Number(b.priority === "required") - Number(a.priority === "required"))
    .flatMap(need => (need.geographicFocus?.split(/[\/·]/).map(value => value.trim()).filter(Boolean)
      ?? [defaultRegion]).map(region => ({ needId: need.id, region,
      category: need.category, query: need.kind === "relation"
        ? need.supportingRole === "meal" ? "식당" : need.supportingRole === "cafe" ? "카페" : "쇼핑"
        : need.purpose.replace(/ 방문 경험$/, "") })));
  const grouped = new Map<string, typeof rows[number] & { needIds: string[] }>();
  for (const row of rows) {
    const key = `${row.region}:${row.category ?? ""}:${row.query}`;
    const existing = grouped.get(key);
    if (existing) existing.needIds.push(row.needId);
    else grouped.set(key, { ...row, needIds: [row.needId] });
  }
  return [...grouped.values()].slice(0, 20);
}

export function primarySearchIntents(active: boolean, plan: ResearchPlan | null,
  defaultRegion: string, legacy: Array<{ region: string; category?: PlaceCategoryId; query?: string }>) {
  return active && plan ? researchSearchIntents(plan, defaultRegion) : legacy;
}

/** Kakao's tourist category group excludes shopping complexes; preserve the
 * research category for post-search eligibility, but search that keyword broadly. */
export function providerCategoryForResearchIntent(intent: { category?: PlaceCategoryId; query?: string }) {
  return intent.category === "tourist" && /쇼핑|아울렛|시장/.test(intent.query ?? "")
    ? undefined : intent.category;
}

/** Provider invocation remains the existing Kakao call supplied by the caller. */
export async function executeResearchIntents<T>(intents: Array<{ region: string; category?: PlaceCategoryId; query?: string }>,
  page: number, search: (intent: { region: string; category?: PlaceCategoryId; query?: string }, page: number) => Promise<T>) {
  return Promise.all(intents.map(intent => search(intent, page)));
}

export function compareResearchSearches(plan: ResearchPlan, region: string,
  legacy: Array<{ region: string; category?: PlaceCategoryId; query?: string }>,
  experienceQualities: ExperienceQuality[] = []) {
  const research = researchSearchIntents(plan, region);
  const key = (row: { region: string; category?: PlaceCategoryId; query?: string }) =>
    `${row.region}:${row.category ?? ""}:${row.query ?? ""}`;
  const researchKeys = new Set(research.map(key));
  const legacyKeys = new Set(legacy.map(key));
  const represented = new Set(plan.needs.filter(need => need.kind === "venue")
    .flatMap(need => need.qualities.map(quality => `${need.category}:${quality}`)));
  const independent = new Set(plan.needs.filter(need => need.kind === "venue").map(need => need.category));
  return { researchOnlySearches: research.filter(row => !legacyKeys.has(key(row))),
    legacyOnlySearches: legacy.filter(row => !researchKeys.has(key(row))),
    qualitativeNeedLostCount: experienceQualities.filter(item => item.category === "any"
      ? ![...represented].some(value => value.endsWith(`:${item.dimension}`))
      : !represented.has(`${item.category === "meal" ? "restaurant" : "cafe"}:${item.dimension}`)).length,
    unnecessaryLegacySupportSearchCount: legacy.filter(row =>
      (row.category === "cafe" || row.category === "restaurant" || row.category === "nature")
      && !independent.has(row.category)).length };
}

export function researchEvidenceFresh(fact: NonNullable<DiscoverCandidate["evidence"]>[number], now = Date.now()) {
  const checked = Date.parse(fact.checkedAt);
  const maxAge = fact.attribute === "hours" ? 24 * 60 * 60 * 1000
    : fact.verification === "search_report" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return Number.isFinite(checked) && checked <= now && now - checked <= maxAge;
}
export function freshResearchCandidateEvidence(candidate: DiscoverCandidate): DiscoverCandidate {
  return { ...candidate, evidence: (candidate.evidence ?? []).filter(fact => researchEvidenceFresh(fact)) };
}
const evidenceText = (candidate: DiscoverCandidate) => (candidate.evidence ?? [])
  .filter(fact => researchEvidenceFresh(fact))
  .map(fact => `${fact.attribute} ${fact.text}`.toLowerCase()).join(" ");
const evidencePattern: Record<string, RegExp> = {
  space: /space|공간|좌석|층고|통창/, interior: /interior|인테리어|조명/, architecture: /architecture|건축|한옥/,
  view: /view|전망|풍경|오션뷰|경관/, ambience: /ambience|분위기/, noise: /noise|소음|조용|시끄러/,
  crowd: /crowd|혼잡|붐비|사람이 많/, seating: /seating|좌석|자리/, terrace: /terrace|테라스/,
  rooftop: /rooftop|루프탑/, window: /window|창가|통창/,
  menu: /menu|메뉴|디저트|케이크/, price: /price|가격|원|₩/,
};
const decisiveEvidence: Record<string, string[]> = {
  ...qualityEvidence, quiet: ["noise", "crowd"],
};

/** Coverage uses only current eligible candidates. Old/stale evidence is not credited. */
export function evaluateResearchCoverage(plan: ResearchPlan, candidates: DiscoverCandidate[], searchedNeedIds: ReadonlySet<string>): ResearchCoverage[] {
  return plan.needs.map(need => {
    if (!searchedNeedIds.has(need.id)) return { needId: need.id, status: "unsearched", candidateCount: 0,
      evidenceCoverage: 0, missingEvidence: [...need.evidenceNeeded] };
    const focusParts = need.geographicFocus?.split(/[\/·]/).map(value => value.trim()).filter(Boolean) ?? [];
    const matches = candidates.filter(candidate => (!need.category || candidate.category === need.category)
      && (!focusParts.length || focusParts.some(focus => candidate.searchRegion === focus
        || candidate.district.includes(focus))));
    const present = need.evidenceNeeded.filter(attribute => matches.some(candidate => evidencePattern[attribute]?.test(evidenceText(candidate))));
    const missingEvidence = need.evidenceNeeded.filter(attribute => !present.includes(attribute));
    const supportedQualities = need.qualities.filter(quality =>
      (decisiveEvidence[quality] ?? []).some(attribute => present.includes(attribute)));
    const sufficient = matches.length >= 1
      && (need.kind !== "evidence" || supportedQualities.length === need.qualities.length);
    return { needId: need.id, status: sufficient ? "sufficient" : "insufficient",
      candidateCount: matches.length, evidenceCoverage: need.qualities.length
        ? supportedQualities.length / need.qualities.length : 1, missingEvidence };
  });
}

export function requiredResearchNeedsMissing(plan: ResearchPlan, coverage: ResearchCoverage[]) {
  const byId = new Map(coverage.map(row => [row.needId, row]));
  return plan.needs.filter(need => need.priority === "required" && need.kind === "venue"
    && (byId.get(need.id)?.candidateCount ?? 0) === 0);
}

export function researchCoverageFallbackReason(plan: ResearchPlan, coverage: ResearchCoverage[]) {
  return requiredResearchNeedsMissing(plan, coverage).length ? "required_need_no_candidates" : null;
}
