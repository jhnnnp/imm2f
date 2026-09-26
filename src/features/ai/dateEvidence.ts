import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateCandidateKey } from "./dateCourse";

export type DateEvidenceAttribute = "space" | "menu" | "experience" | "hours" | "price" | "event" | "reservation";
export type DateEvidenceFact = {
  venueId: string;
  attribute: DateEvidenceAttribute;
  sourceType: "official" | "maps" | "web" | "catalog";
  sourceUrl: string | null;
  retrievedAt: string;
  confidence: number;
  excerpt?: string;
  verification: "provider" | "source_checked" | "search_report" | "unverified";
};

/** Confidence expresses provenance strength, not a guarantee that the claim is true. */
export function candidateEvidenceFacts(candidate: DiscoverCandidate, now = Date.now()): DateEvidenceFact[] {
  const facts: DateEvidenceFact[] = (candidate.evidence ?? []).filter(observation =>
    (!observation.venueId || observation.venueId === dateCandidateKey(candidate))
    && ["space", "menu", "experience"].includes(observation.attribute ?? ""))
    .map(observation => {
      const checked = Date.parse(observation.checkedAt);
      const ageDays = Number.isFinite(checked) ? Math.max(0, (now - checked) / 86_400_000) : 365;
      const base = observation.verification === "source_checked" ? 0.8 : 0.45;
      return {
        venueId: dateCandidateKey(candidate), attribute: observation.attribute!, sourceType: "web" as const,
        sourceUrl: observation.url, retrievedAt: observation.checkedAt,
        excerpt: (observation.sourceExcerpt ?? observation.text).slice(0, 280),
        confidence: Math.max(0.2, base - Math.min(0.2, ageDays / 150)),
        verification: observation.verification ?? "search_report" as const,
      };
    });
  if (candidate.performanceEvent) facts.push({ venueId: dateCandidateKey(candidate), attribute: "event", sourceType: "official",
    sourceUrl: candidate.performanceEvent.sourceUrl, retrievedAt: candidate.performanceEvent.checkedAt,
    excerpt: `${candidate.performanceEvent.title} ${candidate.performanceEvent.dateYmd} ${candidate.performanceEvent.showtimes.join(", ")}`,
    confidence: 0.9, verification: "provider" });
  if (candidate.openingHours) facts.push({ venueId: dateCandidateKey(candidate), attribute: "hours", sourceType: "maps",
    sourceUrl: candidate.mapUrl || null, retrievedAt: new Date(now).toISOString(),
    excerpt: candidate.openingHours.slice(0, 280), confidence: 0.6, verification: "provider" });
  if (candidate.expectedCostTwo != null) facts.push({ venueId: dateCandidateKey(candidate), attribute: "price", sourceType: "catalog",
    sourceUrl: null, retrievedAt: new Date(now).toISOString(), confidence: 0.35, verification: "unverified" });
  return facts;
}

export function evidenceConfidence(candidate: DiscoverCandidate, attribute: DateEvidenceAttribute) {
  return Math.max(0, ...candidateEvidenceFacts(candidate).filter(fact => fact.attribute === attribute)
    .map(fact => fact.confidence));
}
