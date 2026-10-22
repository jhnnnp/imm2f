import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply, AIPlannerState } from "@/features/planning/types/plan";
import { candidateActivitySlot, dateCandidateKey } from "./dateCourse";
import type { CandidateExplorationPreferences } from "./candidateExploration";
import type { ExperiencePlan, ExperienceQuality } from "./experiencePlan";
import type { PlanningIssueOrigin } from "./planningPolicy";
import { researchEvidenceFresh, type ResearchNeed } from "./researchPlan";
import type { SemanticPlanningHints } from "./semanticPlanningHints";

export type DateQualityDimension = ExperienceQuality["dimension"] | "menu";
export type DateQualityContext = {
  state: AIPlannerState;
  message?: string;
  experiencePlan?: ExperiencePlan | null;
  explorationPreferences?: CandidateExplorationPreferences;
  semanticPlanningHints?: SemanticPlanningHints;
  now?: number;
};
export type DateQualityRequirement = {
  id: string;
  dimension: DateQualityDimension;
  category: ExperienceQuality["category"];
  value?: string;
  matchAll?: boolean;
  origin: Extract<PlanningIssueOrigin, "explicit_constraint" | "inferred_preference">;
  status: "supported" | "contradicted" | "unknown" | "missing";
  candidateIds: string[];
  supportingCandidateIds: string[];
  contradictedCandidateIds: string[];
  alternativeCandidateIds: string[];
  evidenceIds: string[];
  sourceUrls: string[];
  message: string;
};
export type DateQualityAssessment = {
  requirements: DateQualityRequirement[];
  needsRepair: boolean;
  repairIssues: string[];
  researchNeeds: ResearchNeed[];
  warnings: string[];
};
type Requirement = Pick<DateQualityRequirement, "dimension" | "category" | "origin" | "value" | "matchAll">;
type QualityFact = { id: string; text: string; excerpt: string; url: string };
const identity = (value: string) => value.normalize("NFKC").replace(/[^가-힣a-z0-9]/gi, "").toLowerCase();
const key = (value: Requirement) => `${value.category}:${value.dimension}:${value.value ?? ""}`;

const menuPattern = (value: string) => new RegExp(value.split("|")
  .map(term => term.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")).join("|"));

function withoutVenueName(text: string, name: string) {
  const pattern = name.trim().split(/\s+/).map(part => part.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")).join("\\s*");
  return pattern ? text.replace(new RegExp(pattern, "gi"), " ") : text;
}

function exactProviderCitation(candidate: DiscoverCandidate, source: string) {
  const url = new URL(source);
  if (candidate.externalSource === "kakao")
    return url.hostname === "place.map.kakao.com" && url.pathname.replace(/^\/|\/$/g, "") === candidate.externalPlaceId;
  return /(?:^|\.)visitkorea\.or\.kr$/.test(url.hostname)
    && ["cid", "contentid", "contentId"].some(key => url.searchParams.get(key) === candidate.externalPlaceId);
}

function citation(raw: string | undefined) {
  try {
    const url = new URL(raw ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function sourceAddressMatches(candidate: DiscoverCandidate, source: string) {
  return [candidate.roadAddress, candidate.address].filter(Boolean).some(address => {
    const district = address.match(/(?:^|\s)([가-힣]+(?:구|군))\s/)?.[1];
    if (district && !identity(source).includes(identity(district))) return false;
    const street = address.match(/([가-힣a-zA-Z0-9·]+(?:로|길|동|리))\s*(산\s*)?(\d+(?:-\d+)?)/);
    if (!street) return false;
    const road = [...street[1]].map(char => char.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")).join("\\s*");
    return new RegExp(road + "\\s*" + (street[2] ? "산\\s*" : "") + street[3] + "(?![\\d-])", "i")
      .test(source.normalize("NFKC"));
  });
}

/** A provider category, a venue name or another branch's citation cannot prove
 * the requested experience. Search reports retain their weaker provenance. */
function qualityFacts(candidate: DiscoverCandidate, now: number): QualityFact[] {
  const facts = (candidate.evidence ?? []).flatMap(fact => {
    const url = citation(fact.url);
    if (!url || fact.venueId !== dateCandidateKey(candidate) || !researchEvidenceFresh(fact, now)
      || !["source_checked", "search_report"].includes(fact.verification ?? "")
      || fact.branchName && identity(fact.branchName) !== identity(candidate.name)
      || fact.sourceVenueName && identity(fact.sourceVenueName) !== identity(candidate.name)
      || fact.sourceAddress && !sourceAddressMatches(candidate, fact.sourceAddress)
      || fact.verification === "search_report" && (!fact.sourceExcerpt?.trim()
        || !fact.sourceVenueName || !fact.sourceAddress)) return [];
    return [{ id: "observation:" + fact.id, text: withoutVenueName(fact.text, candidate.name),
      excerpt: withoutVenueName(fact.sourceExcerpt ?? fact.text, candidate.name), url }];
  });
  const source = citation(candidate.factSourceUrl);
  // Public detail fields have no independent timestamp. Accept them only when
  // their citation is the exact provider entity or an already-current branch fact.
  const branchSource = source && (source === citation(candidate.mapUrl) && exactProviderCitation(candidate, source)
    || facts.some(fact => fact.url === source));
  for (const [id, raw] of [["public:menu", candidate.dishes], ["public:note", candidate.factNote]]) {
    if (!branchSource || !raw) continue;
    const text = withoutVenueName(raw, candidate.name);
    facts.push({ id: id!, text, excerpt: text, url: source });
  }
  return facts;
}

const positive: Record<Exclude<DateQualityDimension, "menu">, RegExp> = {
  quiet: /조용|한적|한산|소음.{0,8}(?:적|낮|없)|붐비지\s*않|혼잡하지\s*않|시끄럽지\s*않/,
  scenic: /전망|풍경|경관|오션뷰|강뷰|바다.{0,8}(?:보이|보는|볼)|탁\s*트인/,
  view: /전망|풍경|경관|오션뷰|강뷰|바다.{0,8}(?:보이|보는|볼)|탁\s*트인/,
  aesthetic: /정원|건축|한옥|채광|자연광|인테리어|통창|테라스/,
  atmosphere: /정원|조명|인테리어|테라스|아늑|차분|따뜻한\s*공간/,
  romantic: /조명|정원|테라스|야경|프라이빗|낭만/,
  spacious: /넓은|넓고|넉넉|여유로운?\s*좌석|좌석.{0,8}많|공간.{0,8}넓/,
  traditional: /한옥|전통|목조|기와/,
  hanok: /한옥|기와|목조\s*주택/,
};
const opposite: Partial<Record<DateQualityDimension, RegExp>> = {
  quiet: /시끄(?:럽|러|러운)|소란|붐비|북적|혼잡|소음.{0,8}(?:크|높|심|많)|대화.{0,8}(?:어렵|힘들)/,
  scenic: /전망.{0,8}(?:없|막혀|가려)|뷰.{0,8}(?:없|막혀|가려)/,
  view: /전망.{0,8}(?:없|막혀|가려)|뷰.{0,8}(?:없|막혀|가려)/,
  spacious: /좁|협소|좌석.{0,8}(?:적|부족)/,
};
const negatedTail = /^(?:한|한\s*곳|하게|히|함|은|는|이|가|을|를|도|인|운|고|하|해|다|지|곳|공간|카페|식당|분위기|좌석|메뉴|편|정도|좋|별로|그리|그다지|\s){0,15}(?:않|아니|아닌|아님|없|말고|싫|원치|원하지|필요\s*없|상관\s*없|안\s*먹|못\s*먹|먹지\s*(?:않|못)|제외|빼|피하|금지|알레르기)/;
const uncertain = /확인.{0,8}(?:못|불가|필요)|정보.{0,6}없|근거.{0,6}없|미확인|모르|알\s*수\s*없|단정.{0,8}어려/;
function hasAffirmative(text: string, pattern: RegExp) {
  return [...text.matchAll(new RegExp(pattern.source, "g"))].some(match => {
    const before = text.slice(Math.max(0, match.index - 6), match.index);
    const after = text.slice(match.index + match[0].length).split(/[.,;!\n]|하지만|그런데/, 1)[0];
    return !/(?:안|못)\s*$/.test(before) && !negatedTail.test(after) && !uncertain.test(after.slice(0, 30));
  });
}
function contradicted(text: string, dimension: DateQualityDimension, term?: string) {
  if (dimension === "menu") return Boolean(term && [...text.matchAll(new RegExp(menuPattern(term).source, "g"))].some(match =>
    negatedTail.test(text.slice(match.index + match[0].length))
    || /^.{0,6}(?:(?:판매|제공|취급).{0,3}(?:안|않|없)|판매\s*종료)/.test(text.slice(match.index + match[0].length))));
  const pattern = positive[dimension];
  const deniedPositive = [...text.matchAll(new RegExp(pattern.source, "g"))].some(match =>
    negatedTail.test(text.slice(match.index + match[0].length)));
  return deniedPositive || Boolean(opposite[dimension] && hasAffirmative(text, opposite[dimension]!));
}
function evidenceStatus(fact: QualityFact, requirement: Requirement): "supported" | "contradicted" | "unknown" {
  if (contradicted(fact.text, requirement.dimension, requirement.value)
    && contradicted(fact.excerpt, requirement.dimension, requirement.value)) return "contradicted";
  const pattern = requirement.dimension === "menu" ? menuPattern(requirement.value ?? "메뉴|요리|대표 음식") : positive[requirement.dimension];
  return hasAffirmative(fact.text, pattern) && hasAffirmative(fact.excerpt, pattern) ? "supported" : "unknown";
}

const menuTerms = /파스타|피자|라멘|초밥|스시|오마카세|스테이크|리소토|리조토|브런치|돼지국밥|국밥|칼국수|냉면|비건|해산물/g;
/** Reusable by candidate ranking and final assessment. Contradicting current
 * sources outrank a positive keyword, including conflicting search reports. */
export function evaluateQualityEvidence(candidate: DiscoverCandidate, dimension: DateQualityDimension,
  now = Date.now(), value?: string) {
  const requirement: Requirement = { dimension, category: "any", origin: "inferred_preference", value };
  const observed = qualityFacts(candidate, now).map(fact => ({ fact, status: evidenceStatus(fact, requirement) }));
  const status: "supported" | "contradicted" | "unknown" = observed.some(item => item.status === "contradicted")
    ? "contradicted" : observed.some(item => item.status === "supported") ? "supported" : "unknown";
  const facts = observed.filter(item => item.status !== "unknown").map(item => item.fact);
  return { status, evidenceIds: [...new Set(facts.map(fact => fact.id))],
    sourceUrls: [...new Set(facts.map(fact => fact.url))] };
}

const explicitDimensions: Array<[DateQualityDimension, RegExp]> = [
  ["quiet", /조용|한적|붐비지\s*않|시끄럽지\s*않/], ["scenic", /전망|오션뷰|뷰\s*좋|경치|풍경/],
  ["aesthetic", /예쁜|이쁜|감성|사진\s*잘|인테리어/], ["hanok", /한옥/],
  ["traditional", /전통/], ["spacious", /넓은|넓고|넉넉한\s*좌석/],
  ["atmosphere", /분위기\s*좋|아늑/], ["romantic", /로맨틱|낭만/],
];
function textRequirements(messages: string[], initial: Map<string, Requirement>) {
  const result = new Map(initial);
  for (const message of messages) for (const clause of message.split(/[.!?\n]|하지만|그런데|대신/).filter(Boolean)) {
    const category: Requirement["category"] = /카페|커피/.test(clause) && !/식당|레스토랑|식사/.test(clause) ? "cafe"
      : /식당|레스토랑/.test(clause) && !/카페/.test(clause) ? "meal" : "any";
    for (const [dimension, pattern] of explicitDimensions) {
      if (!pattern.test(clause)) continue;
      const requirement: Requirement = { dimension, category, origin: "explicit_constraint",
        matchAll: /모두|전부|둘\s*다|곳만|장소만/.test(clause) };
      if (hasAffirmative(clause, pattern)) result.set(key(requirement), requirement);
      else for (const [id, old] of result) if (old.dimension === dimension
        && (category === "any" || old.category === category)) result.delete(id);
    }
    for (const match of clause.matchAll(menuTerms)) {
      const requirement: Requirement = { dimension: "menu", category: "meal", value: match[0], origin: "explicit_constraint" };
      if (hasAffirmative(clause, menuPattern(match[0]))) result.set(key(requirement), requirement);
      else result.delete(key(requirement));
    }
  }
  return [...result.values()];
}

function requirementsFor(context: DateQualityContext): Requirement[] {
  const requirements = new Map<string, Requirement>();
  const add = (value: Requirement) => {
    const previous = requirements.get(key(value));
    if (!previous || previous.origin !== "explicit_constraint") requirements.set(key(value), value);
  };
  const messages = [...(context.state.userRequests ?? [])];
  if (context.message && messages.at(-1) !== context.message) messages.push(context.message);
  // Structured, provenance-bearing choices take precedence; natural text fills
  // specific menu/quality requests absent from the structured experience model.
  for (const quality of context.experiencePlan?.qualitativeNeeds ?? []) add({ ...quality,
    origin: quality.source === "explicit_user" ? "explicit_constraint" : "inferred_preference" });
  const choices = context.explorationPreferences;
  for (const quality of choices?.cafeQualities ?? []) {
    const dimension: DateQualityDimension | undefined = ({ aesthetic: "aesthetic", view: "view", spacious: "spacious",
      traditional: "traditional", dessert: "menu" } as const)[quality];
    if (dimension) add({ dimension, category: "cafe", value: quality === "dessert" ? "디저트|케이크|베이커리" : undefined,
      origin: ["user_selected", "explicit_text"].includes(choices!.provenance[`cafe:${quality}`] ?? "")
        ? "explicit_constraint" : "inferred_preference" });
  }
  for (const value of choices?.cuisines ?? []) {
    if (!/파스타|피자|라멘|초밥|스시|국밥|비건|스테이크|해산물/.test(value)) continue;
    add({ dimension: "menu", category: "meal", value,
      origin: ["user_selected", "explicit_text"].includes(choices!.provenance.cuisine ?? "") ? "explicit_constraint" : "inferred_preference" });
  }
  if (context.semanticPlanningHints?.noisePreference === "quiet" || (context.state.preferences?.crowdTolerance ?? 1) <= 0.3)
    add({ dimension: "quiet", category: "any", origin: "inferred_preference" });
  if ((context.state.preferences?.scenicPreference ?? 0) >= 0.7)
    add({ dimension: "scenic", category: "any", origin: "inferred_preference" });
  return textRequirements(messages, requirements);
}

const label: Record<DateQualityDimension, string> = { quiet: "조용한 대화 환경", scenic: "전망·풍경", view: "전망",
  menu: "메뉴", aesthetic: "공간 특징", atmosphere: "분위기를 설명할 공간 특징", romantic: "낭만적인 공간 특징",
  spacious: "넉넉한 공간", traditional: "전통 공간", hanok: "한옥 공간" };
const evidenceNeeded: Record<DateQualityDimension, string[]> = { quiet: ["noise", "crowd"], scenic: ["view"], view: ["view"],
  menu: ["menu"], aesthetic: ["space", "interior", "architecture"], atmosphere: ["space", "ambience"], romantic: ["space", "ambience"],
  spacious: ["space", "seating"], traditional: ["architecture", "interior"], hanok: ["architecture", "interior"] };

const requirementLabel = (item: Pick<DateQualityRequirement, "dimension" | "value">) => item.dimension === "menu" && item.value
  ? item.value.replaceAll("|", "·") : label[item.dimension];

/** This checks satisfaction of the user's request, independently of structural
 * feasibility. Unknown soft preferences never become itinerary hard failures. */
export function assessDatePlanQuality(input: DateQualityContext & { reply: AIPlannerReply; candidates: DiscoverCandidate[] }): DateQualityAssessment {
  const selectedIds = new Set((input.reply.recommendations ?? []).map(item => item.id));
  for (const item of input.reply.items) if (item.placeId) selectedIds.add(item.placeId.replace(/^discover:/, ""));
  const selected = input.candidates.filter(candidate => selectedIds.has(dateCandidateKey(candidate)));
  const requirements = requirementsFor(input).map(requirement => {
    const relevant = selected.filter(candidate => requirement.category === "any"
      || candidateActivitySlot(candidate) === requirement.category);
    const supported: string[] = []; const contradictedIds: string[] = [];
    const evidenceIds: string[] = []; const sourceUrls: string[] = [];
    for (const candidate of relevant) {
      const evidence = evaluateQualityEvidence(candidate, requirement.dimension, input.now ?? Date.now(), requirement.value);
      if (evidence.status === "contradicted") contradictedIds.push(dateCandidateKey(candidate));
      else if (evidence.status === "supported") supported.push(dateCandidateKey(candidate));
      evidenceIds.push(...evidence.evidenceIds);
      sourceUrls.push(...evidence.sourceUrls);
    }
    // A requested dish needs a matching meal, not the same dish at every meal
    // across a multi-day trip. Explicit all-stop wording can still require all.
    const allRelevant = requirement.matchAll || requirement.dimension !== "menu" && requirement.category !== "any";
    const status: DateQualityRequirement["status"] = supported.length && (!allRelevant || supported.length === relevant.length)
      ? "supported" : contradictedIds.length ? "contradicted"
      : relevant.length ? "unknown" : "missing";
    const display = requirement.dimension === "menu" && requirement.value ? requirement.value.replaceAll("|", "·") : label[requirement.dimension];
    const categoryLabel = requirement.category === "cafe" ? "카페 " : requirement.category === "meal" ? "식사 " : "";
    const message = `${categoryLabel}${display}: ${status === "supported" ? "해당 지점의 출처 근거가 있어요"
      : status === "contradicted" ? "선택한 장소의 자료에 요청과 반대되는 설명이 있어요"
        : status === "missing" ? "이 경험에 해당하는 장소가 일정에 없어요" : "선택한 지점에서 이 조건의 근거를 확인하지 못했어요"}`;
    return { ...requirement, id: `quality:${key(requirement)}`, status, candidateIds: relevant.map(dateCandidateKey),
      supportingCandidateIds: supported, contradictedCandidateIds: contradictedIds,
      alternativeCandidateIds: input.candidates.filter(candidate => !selectedIds.has(dateCandidateKey(candidate))
        && (requirement.category === "any" || candidateActivitySlot(candidate) === requirement.category)
        && evaluateQualityEvidence(candidate, requirement.dimension, input.now ?? Date.now(), requirement.value).status === "supported")
        .slice(0, 6).map(dateCandidateKey),
      evidenceIds: [...new Set(evidenceIds)], sourceUrls: [...new Set(sourceUrls)], message };
  });
  const gaps = requirements.filter(item => item.origin === "explicit_constraint" && item.status !== "supported");
  const contrary = gaps.filter(item => item.status === "contradicted");
  const unknown = gaps.filter(item => item.status !== "contradicted");
  const warnings = [
    ...(contrary.length ? ["선택한 곳의 자료에는 " + contrary.slice(0, 3).map(requirementLabel).join("·")
      + " 요청과 반대되는 설명이 있어요. 이 부분은 다른 후보가 필요해요."] : []),
    ...(unknown.length ? ["요청하신 조건 중 " + unknown.slice(0, 3).map(requirementLabel).join("·")
      + "의 적합성은 아직 확인하지 못했어요. 이 부분은 확인이 필요한 후보 일정이에요."] : []),
  ];
  return { requirements, needsRepair: gaps.length > 0, repairIssues: gaps.map(item => item.message),
    researchNeeds: gaps.slice(0, 6).map((item, index) => ({ id: `quality-repair-${index}`, kind: "evidence",
      category: item.category === "cafe" ? "cafe" : item.category === "meal" ? "restaurant" : undefined,
      purpose: item.message, qualities: item.dimension === "menu" ? [] : [item.dimension],
      evidenceNeeded: evidenceNeeded[item.dimension], priority: "important" })),
    warnings };
}
