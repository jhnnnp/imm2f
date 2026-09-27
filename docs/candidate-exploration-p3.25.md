# P3.25 candidate exploration

Candidate exploration is active by default in both the date and trip AI editor. Set `DATE_CANDIDATE_EXPLORATION_MODE=off` to restore the immediate itinerary path. The same server-side mode is passed to both editors and enforced by the server actions. A local `.env.local` value is not deployed through Git.

The intake reuses the interpreted area, duration, explicit activities, cuisine and pace. It asks only for activities, directly searchable category details and pace. Selected choices are sent as explicit phrases to the existing P2 ExperiencePlan observer. The P3 ResearchPlan is narrowed to the selected categories and carries qualitative evidence needs. If P2 is unavailable, the deterministic research adapter still uses the selected categories.

Each group uses existing saved places, Kakao/Tour search, evidence enrichment and `buildDateCandidatePool`. Session candidates that are unseen and currently eligible are tried first. Current hard eligibility is checked again. Only eligible venues can appear, with eight cards at most. Previously shown, selected and rejected IDs are hidden from the next batch. Qualitative badges require fresh, source-checked evidence; unknown attributes stay unknown. Refinement changes only one group need, while selections remain in the signed session candidate snapshot.

`ItineraryPlanningInput` carries `experiencePlan`, `researchPlan`, verified selected and rejected candidate IDs, and the signed session candidate context for P4. P4 itinerary planning is not implemented here. Until then, selected verified venues are handed to the existing itinerary path as required anchors. The existing search, proposal and verification remain in charge of the resulting itinerary.

`DayRoute` is derived from itinerary items. The map shows one day at a time, numbers markers from one for that day, and never connects stops across days. No separate map itinerary state is persisted.
