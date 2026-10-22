import type { AIPlannerReply } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateCandidateKey } from "@/features/ai/dateCourse";
import { assessDatePlanQuality, type DateQualityAssessment, type DateQualityContext } from "@/features/ai/dateQualityCritic";

export type DateAgentRun = {
  reply: AIPlannerReply;
  candidates: DiscoverCandidate[];
  attempts: number;
  newCandidatesOnRepair: number;
  verifierIssues: string[];
  quality?: DateQualityAssessment;
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

function qualityPenalty(quality: DateQualityAssessment | undefined) {
  return quality?.requirements.filter(item => item.origin === "explicit_constraint")
    .reduce((sum, item) => sum + (item.status === "contradicted" ? 3 : item.status === "missing" ? 2
      : item.status === "unknown" ? 1 : 0), 0) ?? 0;
}

function explicitContradictions(quality: DateQualityAssessment | undefined) {
  return quality?.requirements.filter(item => item.origin === "explicit_constraint"
    && item.status === "contradicted").length ?? 0;
}

/** A structurally feasible plan may still have unresolved explicit qualities. */
function withQualityNotice(reply: AIPlannerReply, quality: DateQualityAssessment | undefined): AIPlannerReply {
  if (!reply.items.length || !quality?.warnings.length) return reply;
  const lines = ["검색된 장소를 바탕으로 후보 일정을 구성했어요.", ...reply.card.lines.slice(1), ...quality.warnings];
  return { ...reply, message: lines.join(" "), card: { ...reply.card, lines,
    followUp: quality.warnings.join(" ") } };
}

/** One bounded plan → verify → research → replan cycle around the course designer. */
export async function runDateAgentCourse(input: {
  candidates: DiscoverCandidate[];
  propose: (candidates: DiscoverCandidate[], quality?: DateQualityAssessment) => Promise<AIPlannerReply>;
  researchAfterFailure: (issues: string[], candidates: DiscoverCandidate[], quality?: DateQualityAssessment) => Promise<DiscoverCandidate[]>;
  allowResearchRepair?: boolean;
  qualityContext?: DateQualityContext;
}): Promise<DateAgentRun> {
  const first = await input.propose(input.candidates);
  const assess = (reply: AIPlannerReply, candidates: DiscoverCandidate[]) => input.qualityContext
    ? assessDatePlanQuality({ ...input.qualityContext, reply, candidates }) : undefined;
  const firstQuality = assess(first, input.candidates);
  const firstIssues = [...new Set([...(first.design?.rejectionReasons ?? []), ...(firstQuality?.repairIssues ?? [])])];
  if (first.items.length && !firstQuality?.needsRepair || first.design?.feasibility?.passed === false || input.allowResearchRepair === false
    || firstIssues.some(issue => /알레르기 안전성 미확인/.test(issue))) {
    return { reply: withQualityNotice(first, firstQuality), candidates: input.candidates, attempts: 1,
      newCandidatesOnRepair: 0, verifierIssues: firstIssues, quality: firstQuality };
  }

  const qualityGaps = firstQuality?.requirements.filter(item => item.origin === "explicit_constraint" && item.status !== "supported") ?? [];
  // Reuse sourced alternatives already in the pool before repeating research.
  const canRepairFromPool = first.items.length > 0 && qualityGaps.length > 0
    && qualityGaps.every(item => item.alternativeCandidateIds.length > 0);
  const researched = canRepairFromPool ? []
    : await input.researchAfterFailure(firstIssues, input.candidates, firstQuality).catch(() => []);
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
  if (!added && !evidenceImproved && !canRepairFromPool) return {
    reply: withQualityNotice(first, firstQuality), candidates: input.candidates, attempts: 1,
    newCandidatesOnRepair: 0, verifierIssues: firstIssues, quality: firstQuality };

  const candidates = [...merged.values()];
  const second = await input.propose(candidates, firstQuality).catch(() => first);
  const secondQuality = assess(second, candidates);
  const firstWithCurrentEvidence = assess(first, candidates);
  const secondIssues = second.design?.rejectionReasons ?? [];
  const firstContradictions = explicitContradictions(firstWithCurrentEvidence);
  const secondContradictions = explicitContradictions(secondQuality);
  const retainFirst = first.items.length > 0 && (!second.items.length
    || secondContradictions > firstContradictions
    || secondContradictions === firstContradictions
      && qualityPenalty(secondQuality) > qualityPenalty(firstWithCurrentEvidence));
  const selectedReply = retainFirst ? first : second;
  const selectedQuality = retainFirst ? firstWithCurrentEvidence : secondQuality;
  return { reply: withQualityNotice(selectedReply, selectedQuality), candidates, attempts: 2, newCandidatesOnRepair: added,
    verifierIssues: [...new Set([...firstIssues, ...secondIssues, ...(selectedQuality?.repairIssues ?? [])])],
    quality: selectedQuality };
}
