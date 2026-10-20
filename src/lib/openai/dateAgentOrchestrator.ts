import type { AIPlannerReply } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateCandidateKey } from "@/features/ai/dateCourse";

export type DateAgentRun = {
  reply: AIPlannerReply;
  candidates: DiscoverCandidate[];
  attempts: number;
  newCandidatesOnRepair: number;
  verifierIssues: string[];
};

function mergeResearchCandidate(previous: DiscoverCandidate, incoming: DiscoverCandidate) {
  const evidence = [...new Map([...(previous.evidence ?? []), ...(incoming.evidence ?? [])]
    .map(fact => [`${fact.id ?? ""}:${fact.url}:${fact.text}`, fact])).values()];
  return { ...previous, ...incoming,
    evidence,
    openingHours: incoming.openingHours || previous.openingHours,
    performanceEvent: incoming.performanceEvent ?? previous.performanceEvent,
    dishes: incoming.dishes || previous.dishes,
    factSourceUrl: incoming.factSourceUrl || previous.factSourceUrl,
  };
}

function planningEvidenceChanged(previous: DiscoverCandidate, next: DiscoverCandidate) {
  return previous.openingHours !== next.openingHours
    || previous.dishes !== next.dishes
    || previous.factSourceUrl !== next.factSourceUrl
    || JSON.stringify(previous.performanceEvent) !== JSON.stringify(next.performanceEvent)
    || JSON.stringify(previous.evidence ?? []) !== JSON.stringify(next.evidence ?? []);
}

/** One bounded plan → verify → research → replan cycle around the course designer. */
export async function runDateAgentCourse(input: {
  candidates: DiscoverCandidate[];
  propose: (candidates: DiscoverCandidate[]) => Promise<AIPlannerReply>;
  researchAfterFailure: (issues: string[], candidates: DiscoverCandidate[]) => Promise<DiscoverCandidate[]>;
  allowResearchRepair?: boolean;
}): Promise<DateAgentRun> {
  const first = await input.propose(input.candidates);
  const firstIssues = first.design?.rejectionReasons ?? [];
  if (first.items.length || first.design?.feasibility?.passed === false || input.allowResearchRepair === false
    || firstIssues.some(issue => /알레르기 안전성 미확인/.test(issue))) {
    return { reply: first, candidates: input.candidates, attempts: 1,
      newCandidatesOnRepair: 0, verifierIssues: firstIssues };
  }

  const researched = await input.researchAfterFailure(firstIssues, input.candidates).catch(() => []);
  const merged = new Map(input.candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  let added = 0;
  let evidenceImproved = false;
  for (const candidate of researched) {
    const key = dateCandidateKey(candidate);
    const previous = merged.get(key);
    if (!previous) {
      added++;
      merged.set(key, candidate);
      continue;
    }
    const next = mergeResearchCandidate(previous, candidate);
    evidenceImproved ||= planningEvidenceChanged(previous, next);
    merged.set(key, next);
  }
  // Exact-venue hours or dated performance evidence can resolve a failed plan
  // without discovering a new business. Identical search results cannot.
  if (!added && !evidenceImproved) return { reply: first, candidates: input.candidates, attempts: 1,
    newCandidatesOnRepair: 0, verifierIssues: firstIssues };

  const candidates = [...merged.values()];
  const second = await input.propose(candidates);
  const secondIssues = second.design?.rejectionReasons ?? [];
  return { reply: second, candidates, attempts: 2, newCandidatesOnRepair: added,
    verifierIssues: [...new Set([...firstIssues, ...secondIssues])] };
}
