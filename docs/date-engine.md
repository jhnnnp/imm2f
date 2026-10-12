# Date course engine

## Conversational reasoning

The default chat entry sends natural-language requests to the conversational engine. The candidate-selection wizard starts only when the user explicitly asks to choose candidates first; an active wizard also allows questions and direct planning. `routeDateChat` uses the configured model to interpret substantive turns, with local validation for numbered edits and unresolved references. Standalone place requests pass through `interpretDateRequest` before eligibility filtering, so new exclusions and corrected preferences apply to the recommendation as well as to full courses.

`recommendPlacesWithOpenAi` asks the model to compare real candidate IDs and return both a selection strategy and a reason with venue-specific evidence references. Course composition preserves the model's intro and individual judgments through validation and presentation. Provider identity, category, location and saved preferences can support contextual inferences; online attributes require matching evidence and attribution. Missing crowds, seating, operating hours and reservation information stay unknown. Questions, comparisons and follow-up explanations use the displayed venues and conversation, with bounded lookup for practical details. If model generation fails, the reply explicitly identifies the fallback.

The default reasoning model is `gpt-6.1-sol`; bounded public-fact lookup defaults to `gpt-4.1-mini` and can be overridden with `OPENAI_SEARCH_MODEL`. JSON generation reserves tokens for hidden reasoning; reasoning-model function calls use the Responses API. Existing credentials remain in the environment. All stages use bounded deadlines, and mutation execution still validates the actual course entities rather than accepting model claims of completed actions.

## Course design

The course path in `src/features/ai/actions.ts` separates discovery, evidence, composition and validation. Time is a constraint only when supplied; venue choice is the primary product.

1. `designDateDiscovery` translates the current message, retained brief and preferences into several concepts and complementary region-scoped search queries. It retains specific food and spatial preferences instead of imposing a meal/cafe/walk template.
2. Search collects candidates before category quotas are applied. `discoveryCatalog` preserves required venues and balances experience types and geographic cells. The existing exclusion and eligibility filters remain in force.
3. `enrichDateVenues` researches up to 16 candidates across experience types in four bounded batches. Observations must cite a URL returned by the web-search tool. This checks citation provenance, not factual entailment; identity and branch matching still depend on the research model. Missing evidence remains unknown.
4. A bounded beam search first builds feasible alternatives around geographic anchors. The curator can select one by seed ID or propose three complete alternatives using only candidate IDs. `evaluateCourse` checks mandatory and excluded venues, explicit activity requirements, cuisine, repeated experiences, stop counts, day coverage, order, distance and schedule feasibility. It optimizes stop order per day, respecting explicit ordering, for up to seven stops per day.
5. Invalid alternatives receive one bounded repair request. If none qualifies, a bounded beam search may return an explicitly marked fallback, but only if it passes the same constraints. Otherwise the caller asks for a useful relaxation instead of publishing an invalid course.
6. The result includes source-backed stop observations and design diagnostics: alternative count, evidence count, total straight-line distance and degraded mode. Direct edits keep existing entities; discovery-based swaps retain required venues and course size.

## Boundaries

Distances and travel times are coordinate-based estimates, not road, pedestrian or transit route results. Opening hours, reservation availability and total spending are not comprehensively verified. Candidate discovery and observations depend on external provider availability; evidence collection covers a bounded shortlist and is not an exhaustive survey. Requests can perform an additional discovery LLM call, up to four research calls, a composition call and one repair, so production latency/cost measurement remains necessary.

Verification includes focused chatbot regressions, TypeScript checking, a production build, real calls using the configured model, and browser checks of the chat entry, live place recommendations and follow-up questions. Controlled live fixtures cover preference correction, grounded selection, course explanations and tool requests; they do not constitute an exhaustive evaluation of all conversations or venue facts. The whole-repository test suite still has failures in pre-existing memory, taste, workspace and saved-place tests, with no additional failures from this change.

Failed additions and empty course results retain the previously accepted course state. Additions cannot silently commit fewer stops. Numbered or named swaps target that stop; category swaps replace one matching stop unless the user requests all. Board/game/study cafés are excluded from ordinary café matching. Discovery alternatives cannot bypass walking-distance limits. Rejection reasons are returned in design diagnostics, and fallback selection is disclosed in the reply.
