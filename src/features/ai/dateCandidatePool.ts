import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { candidateActivitySlot, dateCandidateKey } from "./dateCourse";
import { courseSize, matchesTerm, tripDayYmd } from "./dateBrief";
import { candidateFoodConflict } from "./dateIntent";
import { candidateEvidenceFacts, type DateEvidenceFact } from "./dateEvidence";
import { venueScoreBreakdown } from "./courseDesign";

export type DateCandidateRecord = {
  id: string;
  type: ReturnType<typeof candidateActivitySlot>;
  venue: DiscoverCandidate;
  facts: {
    coordinates: [number, number];
    openingHours: string | null;
    costTwoWon: number | null;
    eventDate: string | null;
  };
  evidence: DateEvidenceFact[];
  scores: ReturnType<typeof venueScoreBreakdown>;
  rejectedReasons: string[];
};

/** Search results become inspectable candidates before any course is composed. */
export function buildDateCandidatePool(
  candidates: DiscoverCandidate[], state: AIPlannerState, saved = new Set<string>(),
  admit?: (candidate: DiscoverCandidate) => boolean,
): { records: DateCandidateRecord[]; eligible: DiscoverCandidate[] } {
  const records: DateCandidateRecord[] = [];
  const seen = new Set<string>();
  const validDates = state.dateLabel ? Array.from({ length: courseSize(state).days }, (_, day) => tripDayYmd(state, day)) : [];
  for (const venue of candidates) {
    const id = dateCandidateKey(venue);
    if (seen.has(id)) continue;
    seen.add(id);
    const rejectedReasons: string[] = [];
    if (state.excludedPlaces.some(name => matchesTerm(venue, name))) rejectedReasons.push("excluded_place");
    const menu = (venue.evidence ?? []).filter(item => item.attribute === "menu").map(item => item.text).join(" ");
    if (candidateFoodConflict(`${venue.name} ${venue.detailedCategory ?? ""} ${venue.dishes ?? ""} ${menu}`, state.excludedFoods ?? []))
      rejectedReasons.push("excluded_food");
    if (state.budgetWon != null && venue.expectedCostTwo != null && venue.expectedCostTwo > state.budgetWon)
      rejectedReasons.push("over_budget");
    if (venue.performanceEvent && validDates.length && !validDates.includes(venue.performanceEvent.dateYmd))
      rejectedReasons.push("event_date_mismatch");
    if (admit && !admit(venue)) rejectedReasons.push("search_policy");
    records.push({ id, type: candidateActivitySlot(venue), venue,
      facts: { coordinates: venue.coordinates, openingHours: venue.openingHours ?? null,
        costTwoWon: venue.expectedCostTwo ?? null, eventDate: venue.performanceEvent?.dateYmd ?? null },
      evidence: candidateEvidenceFacts(venue), scores: venueScoreBreakdown(venue, state, saved), rejectedReasons });
  }
  return { records, eligible: records.filter(record => !record.rejectedReasons.length).map(record => record.venue) };
}
