# P3 ResearchPlan search boundary

`DATE_RESEARCH_PLAN_MODE=off|shadow|active` defaults to `off`.

- **off:** Existing discovery, task-planner search and rescue search continue unchanged. No P3 ExperiencePlan call is added.
- **shadow:** Build a ResearchPlan from the validated P2 ExperiencePlan, compare its needs with legacy intents, and keep legacy search in authority.
- **active:** Search the ResearchPlan's venue and supporting relation needs through existing Kakao/Tour providers. A required venue need with no currently eligible candidate triggers legacy search. Missing optional quality evidence remains an insufficient coverage result, not a fallback trigger.

The ResearchPlan is a pure adapter over the model-produced ExperiencePlan. It adds no OpenAI completion of its own. Each primary ExperienceBlock yields one venue need; the first block of each day and an explicitly required activity are required, while other blocks remain important. Quality dimensions yield separate evidence needs; meal/cafe/rest/shopping within a block become relation needs. `qualities` and `evidenceNeeded` stay separate from provider keyword queries. Candidate identities always come from providers and pass through the existing CandidatePool.

Active quality research uses the existing cited web-search and branch-identity checks. Research results without a cited exact branch are discarded. Search-reported evidence expires after seven days, source-checked evidence after thirty days, and opening-hour observations after one day in the active path. Missing evidence is unknown.

The active search branch skips legacy eager activity prefetch, legacy geo/Tour defaults, the date task planner's missing-activity search and count-based rescue. It still builds the legacy discovery brief for downstream course compatibility, but ignores its queries as the active primary search list. On required-need failure it runs those queries and geo/rescue fallback. The existing candidate eligibility, ranking, proposal, verifier and response contracts remain in place. The existing fixed venue research pass inside course proposal is skipped only when active ResearchPlan enrichment succeeded.

Diagnostics record need and coverage counts, differences against legacy queries, lost quality dimensions, and fallback reason without recording the full user message. The P3.5 Place Relation stage will need provider identity, coordinates, verified parent-complex identity, entrance/walk distance, and evidence that a supporting venue is actually inside or adjacent to the primary visit context. P3 does not infer that relation from matching names or a broad district.
