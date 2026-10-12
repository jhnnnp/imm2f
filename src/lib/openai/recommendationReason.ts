import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateCandidateKey, dateCategoryLabel } from "@/features/ai/dateCourse";

export type RecommendationEvidence = {
  id: string;
  text: string;
  url?: string;
  verification?: "provider" | "user_preference" | "search_report" | "source_checked";
};

function safeEvidenceUrl(raw: string | undefined) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function recommendationEvidence(candidate: DiscoverCandidate,
  preferences: { saved?: boolean; bothWant?: boolean } = {}): RecommendationEvidence[] {
  const facts: RecommendationEvidence[] = [
    { id: "provider:identity", text: candidate.name, verification: "provider" },
    { id: "provider:category", text: candidate.detailedCategory || dateCategoryLabel(candidate), verification: "provider" },
    { id: "provider:location", text: `${candidate.district} ${candidate.roadAddress || candidate.address}`.trim(), verification: "provider" },
  ];
  if (preferences.saved) facts.push({ id: "preference:saved", text: "사용자가 저장한 장소", verification: "user_preference" });
  if (preferences.bothWant) facts.push({ id: "preference:both", text: "두 사람이 가고 싶다고 저장한 장소", verification: "user_preference" });
  const source = safeEvidenceUrl(candidate.factSourceUrl);
  if (source) {
    if (candidate.dishes) facts.push({ id: "public:menu", text: candidate.dishes, url: source, verification: "search_report" });
    if (candidate.factNote) facts.push({ id: "public:note", text: candidate.factNote, url: source, verification: "search_report" });
    if (candidate.rating != null) facts.push({ id: "public:rating", text: `${candidate.rating}점${candidate.ratingCount ? ` 후기 ${candidate.ratingCount}` : ""}`, url: source, verification: "search_report" });
  }
  for (const observation of candidate.evidence ?? []) {
    if (observation.venueId && observation.venueId !== dateCandidateKey(candidate)) continue;
    const url = safeEvidenceUrl(observation.url);
    if (!observation.id || !observation.text.trim() || !url) continue;
    facts.push({ id: `observation:${observation.id}`, text: observation.text.slice(0, 600), url,
      verification: observation.verification ?? "search_report" });
  }
  const event = candidate.performanceEvent;
  const eventUrl = safeEvidenceUrl(event?.sourceUrl);
  if (event && eventUrl) facts.push({ id: "public:performance", text: `${event.title} ${event.dateYmd} ${event.showtimes.join(" ")}`,
    url: eventUrl, verification: "provider" });
  return [...new Map(facts.map(fact => [fact.id, fact])).values()];
}

function cleanReason(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\n\r*_#`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// These checks catch concrete unsupported claims; evidence references and the
// curation prompt also constrain semantic inferences. They are not a fact checker.
const CLAIM_FAMILIES = [
  /예약|웨이팅|대기\s*줄|주차|영업|휴무|브레이크타임|무료|가격|평점|별점/,
  /조용|한적|시끄럽|붐비|혼잡|북적|프라이빗|아늑/,
  /정원|테라스|루프탑|통창|한옥|채광|자연광|창가|전망|(?<!리)뷰/,
  /시그니처|대표\s*메뉴|인기\s*메뉴|수제|제철/,
  /유명|인기|맛있|최고|미쉐린|미슐랭/,
];

/** A venue's literal name is its identity, not an assertion about its qualities. */
function withoutVenueNames(text: string, facts: RecommendationEvidence[], knownVenueNames: readonly string[]) {
  const names = [...new Set([...facts.filter(fact => fact.id === "provider:identity").map(fact => fact.text), ...knownVenueNames])]
    .filter(name => name.trim()).sort((a, b) => b.length - a.length);
  return names.reduce((result, name) => {
    const pattern = [...name.replace(/\s/g, "")].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
    return result.replace(new RegExp(pattern, "g"), " ");
  }, text);
}

/** Allow local uncertainty/checking language, without letting a later caveat
 * excuse an earlier affirmative claim in the same sentence. */
function isAttributeCaveat(text: string, end: number) {
  const tail = text.slice(end).split(/[.!?;。]|하지만|그런데|다만|지만|는데/)[0];
  // A quoted proposition can include positive adjectives while explicitly
  // declining to assert them: "조용한 곳이라고 단정하기는 어려워요".
  const quotedJudgment = /(?:라고|다고)\s*(?:단정|판단|말|확정|비교)[^.!?;]{0,65}(?:어려|할\s*수\s*없|근거(?:는|가)?\s*없)/.exec(tail);
  if (quotedJudgment && quotedJudgment.index <= 65
    && !/해서|라서|하므로|하여|이고|이며|인데|하고|않고|않아|편해|확정|보장/.test(tail.slice(0, quotedJudgment.index))) return true;
  const marker = /(?:확인|검증)(?:되지\s*않|하지\s*못|할\s*수\s*없|이\s*안\s*되|하지\s*않|이?\s*필요)|(?:확인|문의)(?:해야|하셔야|할\s*필요)|(?:확인|문의)(?:해|하셔|하시|할|하는\s*(?:게|것이|것을))?\s*(?:주세요|보세요|필요|권해|좋|추천)|(?:정보|자료|근거)(?:는|가|를)?\s*(?:아직\s*)?없|(?:알|단정할|판단할)\s*수\s*없|모르|미확인|불확실/.exec(tail);
  if (!marker || marker.index > 65) return false;
  const prefix = tail.slice(0, marker.index);
  // Questions about availability may use "가능 여부/가능한지". An affirmative
  // "가능해요/가능하고" or "조용해서 좋지만" still needs cited factual support.
  return !/있|없|좋|해서|라서|하므로|하여|이고|이며|인데|하고|않고|않아|편해|쾌적|확정|보장|가능(?!\s*(?:여부|한지|할지))/.test(prefix);
}

const MOOD_ATTRIBUTE = /^(?:조용|한적|시끄럽|붐비|혼잡|북적|프라이빗|아늑)$/;

function isNegatedAttribute(text: string, end: number) {
  const tail = text.slice(end).replace(/\s+/g, "");
  return /^(?:하|이)?지(?:는|도)?(?:않|못)|^(?:한|함|성|도)(?:편|곳|공간|카페|분위기|매장|좌석)?(?:이|은|는|가)?(?:아니|아닌|아닙|아닐|없)/.test(tail);
}

function supportsAttributeClaim(facts: RecommendationEvidence[], word: string, claimText: string, end: number) {
  // A business name containing "정원" or "조용" is still just a business name.
  const sources = facts.filter(fact => fact.id !== "provider:identity");
  if (!MOOD_ATTRIBUTE.test(word)) return sources.some(fact => fact.text.replace(/\s+/g, "").includes(word.replace(/\s+/g, "")));
  const claimNegative = isNegatedAttribute(claimText, end);
  const polarities = sources.flatMap(fact => [...fact.text.matchAll(new RegExp(word, "g"))]
    .filter(match => !isAttributeCaveat(fact.text, match.index + word.length))
    .map(match => isNegatedAttribute(fact.text, match.index + word.length)));
  return polarities.includes(claimNegative) && !polarities.includes(!claimNegative);
}

/** Accept a model's judgment only with references belonging to this exact venue. */
export function groundedRecommendationReason(raw: unknown, evidenceIds: unknown,
  facts: RecommendationEvidence[], max = 180, knownVenueNames: readonly string[] = []) {
  const text = cleanReason(raw, max);
  if (text.length < 8 || /https?:\/\/|알레르기.{0,8}(?:안전|걱정\s*없)|무조건|보장/.test(text)) return "";
  if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 8
    || evidenceIds.some(id => typeof id !== "string")) return "";
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  if (evidenceIds.some(id => !byId.has(id))) return "";
  const cited = [...new Set(evidenceIds as string[])].map(id => byId.get(id)!);
  // A comparison may mention another provider-verified candidate's name. This
  // exempts its literal identity only; it does not supply any of its attributes.
  const claimText = withoutVenueNames(text, facts, knownVenueNames);
  for (const family of CLAIM_FAMILIES) {
    for (const claim of claimText.matchAll(new RegExp(family.source, "g"))) {
      if (!supportsAttributeClaim(cited, claim[0], claimText, claim.index + claim[0].length)
        && !isAttributeCaveat(claimText, claim.index + claim[0].length)) return "";
    }
  }
  const allowedNumbers = new Set(cited.filter(fact => fact.id !== "provider:identity")
    .flatMap(fact => fact.text.match(/\d+(?:[.,:]\d+)*/g) ?? []));
  if ((claimText.match(/\d+(?:[.,:]\d+)*/g) ?? []).some(number => !allowedNumbers.has(number))) return "";
  // A searched observation is useful but its claim is still attributed to the
  // source. Do not let natural wording upgrade it to independently verified fact.
  return cited.some(fact => fact.verification === "search_report")
    && !/자료|소개|후기|검색|안내|기재|온라인/.test(text) ? `온라인 자료를 보면, ${text}` : text;
}

/** The intro explains the selection strategy; venue facts belong in cited reasons. */
export function recommendationIntro(raw: unknown, candidates: DiscoverCandidate[], max = 260, numberContext = "") {
  const text = cleanReason(raw, max);
  if (text.length < 10 || /https?:\/\/|무조건|보장/.test(text)) return "";
  for (const claim of text.matchAll(new RegExp(CLAIM_FAMILIES[0].source, "g"))) {
    if (!isAttributeCaveat(text, claim.index + claim[0].length)) return "";
  }
  if (/\d+\s*(?:분|시간|시\b|원|점|%|미터|km\b)/i.test(text)) return "";
  const countOrNames = `${candidates.length} ${candidates.map(candidate => candidate.name).join(" ")} ${numberContext}`;
  const allowedNumbers = new Set(countOrNames.match(/\d+(?:[.,:]\d+)*/g) ?? []);
  if ((text.match(/\d+(?:[.,:]\d+)*/g) ?? []).some(number => !allowedNumbers.has(number))) return "";
  return text;
}
