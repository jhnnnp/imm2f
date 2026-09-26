import { loadEnvConfig } from "@next/env";
import { emptyDateBrief, withAreas } from "../src/features/ai/dateBrief";
import { candidateActivitySlot, dateCandidateKey } from "../src/features/ai/dateCourse";
import { isDateCourseCandidate } from "../src/lib/kakao/dateCandidate";
import { searchKakaoPlacesRemote } from "../src/lib/kakao/local";
import { discoverVenueLeads, leadMatchesCandidate } from "../src/lib/openai/discoverVenueLeads";
import { enrichDateVenues } from "../src/lib/openai/enrichDateVenues";
import { readVenueEvidence } from "../src/lib/openai/venueEvidenceStore";
import { getSupabaseSecretKey, getSupabaseUrl } from "../src/lib/supabase/env";
import type { DiscoverCandidate } from "../src/features/places/types/place";
import type { AIPlannerState } from "../src/features/planning/types/plan";

loadEnvConfig(process.cwd());

const PILOT_AREAS = ["왕십리", "성수", "연남", "서촌", "을지로"];
const QUERIES = [
  { activity: "cafe", query: "카페", max: 12 },
  { activity: "meal", query: "맛집", max: 12 },
  { activity: "exhibit", query: "미술관", max: 5 },
  { activity: "exhibit", query: "갤러리", max: 5 },
] as const;

/** Populates only source-linked facts. Provider search results themselves are
 * not copied to the shared corpus, and failed branch checks write nothing. */
async function collectAreaCandidates(area: string, state: AIPlannerState) {
  const baseSearches = Promise.all(QUERIES.flatMap(item => [1, 2].map(async page => ({
    activity: item.activity,
    response: await searchKakaoPlacesRemote({ region: area, query: item.query, page }),
  }))));
  const editorialLeads = discoverVenueLeads(state).then(async leads => {
    const resolved = await Promise.all(leads.map(async lead => {
      const response = await searchKakaoPlacesRemote({ query: `${area} ${lead.name}` });
      return response.ok ? response.places.find(place => leadMatchesCandidate(lead, place)) : undefined;
    }));
    return resolved.filter((place): place is DiscoverCandidate => Boolean(place));
  });
  const [searches, leads] = await Promise.all([baseSearches, editorialLeads]);
  const byRole = new Map<string, DiscoverCandidate[]>();
  for (const { activity, response } of searches) {
    if (!response.ok) {
      console.warn("date_corpus_search_unavailable", { area, activity, code: response.code });
      continue;
    }
    const group = byRole.get(activity) ?? [];
    const max = QUERIES.find(item => item.activity === activity)!.max;
    for (const place of response.places) {
      if (candidateActivitySlot(place) !== activity || !isDateCourseCandidate(place, [])) continue;
      if (group.some(candidate => dateCandidateKey(candidate) === dateCandidateKey(place))) continue;
      if (group.length < max) group.push(place);
    }
    byRole.set(activity, group);
  }
  return [...new Map([...leads, ...byRole.values()].flat().map(candidate => [dateCandidateKey(candidate), candidate])).values()];
}

async function buildArea(area: string) {
  const state = withAreas(emptyDateBrief(), [area]);
  state.activities = ["cafe", "meal", "exhibit"];
  state.userRequests = [`${area}에서 예쁜 카페와 개성 있는 저녁 식사, 전시 데이트`];
  const candidates = await collectAreaCandidates(area, state);
  if (!candidates.length) {
    console.warn("date_corpus_no_candidates", { area });
    return;
  }
  const existing = await readVenueEvidence(candidates);
  const rejected: Record<string, number> = {};
  const started = Date.now();
  const enriched = await enrichDateVenues(candidates, state, {
    onRejected: detail => { rejected[detail.reason] = (rejected[detail.reason] ?? 0) + 1; },
  }, "background");
  const supported = enriched.filter(candidate => candidate.evidence?.length);
  const newSupported = supported.filter(candidate => !existing.has(dateCandidateKey(candidate)));
  const byRole = Object.fromEntries(state.activities.map(role => [role, {
    candidates: candidates.filter(candidate => candidateActivitySlot(candidate) === role).length,
    supported: supported.filter(candidate => candidateActivitySlot(candidate) === role).length,
  }]));
  console.info("date_corpus_area", { area, elapsedMs: Date.now() - started,
    candidates: candidates.length, supported: supported.length, newlySupported: newSupported.length,
    byRole, rejected });
}

async function main() {
  const args = process.argv.slice(2);
  const areas = args.includes("--pilot") ? PILOT_AREAS : args.filter(value => !value.startsWith("--"));
  if (!areas.length) {
    console.error("Usage: npm run corpus:build -- 왕십리 [성수 ...] | --pilot");
    process.exitCode = 2;
    return;
  }
  if (!process.env.OPENAI_API_KEY || !process.env.KAKAO_REST_API_KEY || !getSupabaseUrl() || !getSupabaseSecretKey()) {
    console.error("The corpus builder requires OpenAI, Kakao Local and Supabase service credentials.");
    process.exitCode = 2;
    return;
  }
  for (const area of areas) await buildArea(area);
}

main().catch(error => {
  console.error("date_corpus_build_failed", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
