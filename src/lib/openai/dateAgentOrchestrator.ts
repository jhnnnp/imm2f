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

/** One bounded plan → verify → research → replan cycle around the course designer. */
export async function runDateAgentCourse(input: {
  candidates: DiscoverCandidate[];
  propose: (candidates: DiscoverCandidate[]) => Promise<AIPlannerReply>;
  researchAfterFailure: (issues: string[], candidates: DiscoverCandidate[]) => Promise<DiscoverCandidate[]>;
  allowResearchRepair?: boolean;
}): Promise<DateAgentRun> {
  const first = await input.propose(input.candidates);
  const firstIssues = first.design?.rejectionReasons ?? [];
  if (first.items.length || input.allowResearchRepair === false
    || firstIssues.some(issue => /알레르기 안전성 미확인/.test(issue))) {
    return { reply: first, candidates: input.candidates, attempts: 1,
      newCandidatesOnRepair: 0, verifierIssues: firstIssues };
  }

  const researched = await input.researchAfterFailure(firstIssues, input.candidates);
  const merged = new Map(input.candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
  let added = 0;
  for (const candidate of researched) {
    const key = dateCandidateKey(candidate);
    if (!merged.has(key)) added++;
    merged.set(key, candidate);
  }
  if (!added) return { reply: first, candidates: input.candidates, attempts: 1,
    newCandidatesOnRepair: 0, verifierIssues: firstIssues };

  const candidates = [...merged.values()];
  const second = await input.propose(candidates);
  const secondIssues = second.design?.rejectionReasons ?? [];
  return { reply: second, candidates, attempts: 2, newCandidatesOnRepair: added,
    verifierIssues: [...new Set([...firstIssues, ...secondIssues])] };
}
