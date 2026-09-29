import type { DiscoverCandidate } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import { dateCandidateKey, type DateCourseRow } from "./dateCourse";

/** A relationship is only asserted when both provider names identify the same
 * named facility and their coordinates corroborate it. A shared street address
 * or short distance alone is not evidence of a shared shopping complex. */
export type ComplexRelation = {
  candidateIds: [string, string];
  complexKey: string;
  evidence: Array<{ candidateId: string; source: "provider_name" | "provider_address" | "source_checked_observation";
    text: string; url: string }>;
  distanceMeters: number;
};
export type CandidateGraph = { relations: ComplexRelation[] };

const FACILITY = /(?:[가-힣A-Za-z0-9]{2,}(?:\s*(?:프리미엄|디자이너))?\s*(?:아울렛|백화점|쇼핑몰|복합몰|몰)|스타필드|엔터식스|타임스퀘어|코엑스몰|롯데월드몰)(?:\s*[가-힣A-Za-z0-9]{2,}점)?/g;
const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase()
  .replace(/프리미엄(?=아울렛)/g, "");
const located = (candidate: DiscoverCandidate) => candidate.coordinates.every(value =>
  Number.isFinite(value) && Math.abs(value) > 1);

function namedComplexes(candidate: DiscoverCandidate): string[] {
  const supported = (candidate.evidence ?? []).filter(item => item.venueId === dateCandidateKey(candidate)
    && item.verification === "source_checked" && item.url);
  const matches = [candidate.name, ...supported.map(item => item.text)]
    .flatMap(text => [...text.matchAll(FACILITY)].map(match => compact(match[0])));
  return [...new Set(matches.filter(key => key.length >= 4))];
}

function relationEvidence(candidate: DiscoverCandidate, complexKey: string,
  fallback: "provider_name" | "provider_address") {
  if ([...candidate.name.matchAll(FACILITY)].some(match => compact(match[0]) === complexKey))
    return { candidateId: dateCandidateKey(candidate), source: "provider_name" as const,
      text: candidate.name, url: candidate.mapUrl };
  const observed = (candidate.evidence ?? []).find(item => item.venueId === dateCandidateKey(candidate)
    && item.verification === "source_checked" && item.url
    && [...item.text.matchAll(FACILITY)].some(match => compact(match[0]) === complexKey));
  if (observed) return { candidateId: dateCandidateKey(candidate),
    source: "source_checked_observation" as const, text: observed.text, url: observed.url };
  return { candidateId: dateCandidateKey(candidate), source: fallback,
    text: `${candidate.name} · ${candidate.roadAddress || candidate.address}`, url: candidate.mapUrl };
}

function preciseAddresses(candidate: DiscoverCandidate) {
  return [candidate.address, candidate.roadAddress].filter(address => /\d/.test(address)
    && address.trim().length >= 12).map(compact);
}

export function buildCandidateGraph(candidates: DiscoverCandidate[]): CandidateGraph {
  const byComplex = new Map<string, DiscoverCandidate[]>();
  for (const candidate of candidates) if (located(candidate)) for (const complexKey of namedComplexes(candidate)) {
    const group = byComplex.get(complexKey) ?? [];
    group.push(candidate);
    byComplex.set(complexKey, group);
  }
  const relations: ComplexRelation[] = [];
  const seen = new Set<string>();
  const add = (a: DiscoverCandidate, b: DiscoverCandidate, complexKey: string,
    basis: "provider_name" | "provider_address", meters: number,
    namedSource?: DiscoverCandidate) => {
    const ids = [dateCandidateKey(a), dateCandidateKey(b)].sort() as [string, string];
    const pairKey = ids.join("|");
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    relations.push({ candidateIds: ids, complexKey, distanceMeters: meters,
      evidence: [...new Set([a, b, ...(namedSource ? [namedSource] : [])])]
        .map(candidate => relationEvidence(candidate, complexKey, candidate === namedSource ? "provider_name" : basis)) });
  };
  for (const [complexKey, group] of byComplex) for (let left = 0; left < group.length; left++)
    for (let right = left + 1; right < group.length; right++) {
      const a = group[left];
      const b = group[right];
      const meters = Math.round(distanceMeters(a.coordinates, b.coordinates));
      if (meters > 450 || !Number.isFinite(meters)) continue;
      add(a, b, complexKey, "provider_name", meters);
    }
  // One branch name may omit its mall. An exact numbered provider address plus
  // close coordinates can corroborate the other's explicit facility name.
  for (let left = 0; left < candidates.length; left++) for (let right = left + 1; right < candidates.length; right++) {
    const a = candidates[left];
    const b = candidates[right];
    if (!located(a) || !located(b)) continue;
    const complexKey = namedComplexes(a)[0] ?? namedComplexes(b)[0];
    if (!complexKey) continue;
    const meters = Math.round(distanceMeters(a.coordinates, b.coordinates));
    if (meters > 300 || !Number.isFinite(meters)) continue;
    const addresses = new Set(preciseAddresses(a));
    if (!preciseAddresses(b).some(address => addresses.has(address))) continue;
    add(a, b, complexKey, "provider_address", meters,
      namedComplexes(a).includes(complexKey) ? a : b);
  }
  for (const named of candidates) if (located(named)) for (const complexKey of namedComplexes(named)) {
    const namedAddresses = new Set(preciseAddresses(named));
    const members = candidates.filter(candidate => candidate !== named
      && Math.round(distanceMeters(named.coordinates, candidate.coordinates)) <= 300
      && preciseAddresses(candidate).some(address => namedAddresses.has(address)));
    for (let left = 0; left < members.length; left++) for (let right = left + 1; right < members.length; right++) {
      const a = members[left];
      const b = members[right];
      const meters = Math.round(distanceMeters(a.coordinates, b.coordinates));
      if (meters <= 300) add(a, b, complexKey, "provider_address", meters, named);
    }
  }
  return { relations };
}

/** Visit the same complex on one day. Separate days indicate an avoidable
 * return trip unless the user explicitly asks for that repetition. */
export function repeatedComplexDays(rows: DateCourseRow[], graph: CandidateGraph) {
  const dayById = new Map(rows.map(row => [row.id, row.day_index ?? 0]));
  return graph.relations.flatMap(relation => {
    const a = dayById.get(relation.candidateIds[0]);
    const b = dayById.get(relation.candidateIds[1]);
    return a != null && b != null && a !== b ? [{ relation, dayIndices: [a, b] as [number, number] }] : [];
  });
}
