# Date course engine

The course path in `src/features/ai/actions.ts` separates discovery, evidence, composition and validation. Time is a constraint only when supplied; venue choice is the primary product.

1. `designDateDiscovery` translates the current message, retained brief and preferences into several concepts and complementary region-scoped search queries. It retains specific food and spatial preferences instead of imposing a meal/cafe/walk template.
2. Search collects candidates before category quotas are applied. `discoveryCatalog` preserves required venues and balances experience types and geographic cells. The existing exclusion and eligibility filters remain in force.
3. `enrichDateVenues` researches up to 16 candidates across experience types in four bounded batches. Observations must cite a URL returned by the web-search tool. This checks citation provenance, not factual entailment; identity and branch matching still depend on the research model. Missing evidence remains unknown.
4. A bounded beam search first builds feasible alternatives around geographic anchors. The curator can select one by seed ID or propose three complete alternatives using only candidate IDs. `evaluateCourse` checks mandatory and excluded venues, explicit activity requirements, cuisine, repeated experiences, stop counts, day coverage, order, distance and schedule feasibility. It optimizes stop order per day, respecting explicit ordering, for up to seven stops per day.
5. Invalid alternatives receive one bounded repair request. If none qualifies, a bounded beam search may return an explicitly marked fallback, but only if it passes the same constraints. Otherwise the caller asks for a useful relaxation instead of publishing an invalid course.
6. The result includes source-backed stop observations and design diagnostics: alternative count, evidence count, total straight-line distance and degraded mode. Direct edits keep existing entities; discovery-based swaps retain required venues and course size.

## Boundaries

Distances and travel times are coordinate-based estimates, not road, pedestrian or transit route results. Opening hours, reservation availability and total spending are not comprehensively verified. Candidate discovery and observations depend on external provider availability; evidence collection covers a bounded shortlist and is not an exhaustive survey. Requests can perform an additional discovery LLM call, up to four research calls, a composition call and one repair, so production latency/cost measurement remains necessary.

TypeScript checking and diff whitespace checks passed after the latest changes. No live API, browser verification or execution tests were run for this iteration, following the request to prioritize engine code. This document describes the implementation, not a verified production-quality claim.

Failed additions and empty course results retain the previously accepted course state. Additions cannot silently commit fewer stops. Numbered or named swaps target that stop; category swaps replace one matching stop unless the user requests all. Board/game/study cafés are excluded from ordinary café matching. Discovery alternatives cannot bypass walking-distance limits. Rejection reasons are returned in design diagnostics, and fallback selection is disclosed in the reply.
