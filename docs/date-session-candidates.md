# Planning session candidate context

`SessionCandidateContext` is a bounded read model carried by the date editor between turns. The existing `recommendDatePlan` action and `AIPlannerResult` remain unchanged. The editor calls `recommendDatePlanWithSession`, which returns the same planner result beside a signed candidate context. The browser holds that context only while the editor is mounted; switching modes resets it. A successful explicit new date or trip plan also resets the context.

The server verifies the signature before reading a returned context. It uses `SESSION_CANDIDATE_SIGNING_KEY` when configured, otherwise the existing Supabase server secret. Without either key, previous context is ignored and the legacy recommendation still completes. Context is not stored in a database or long-term couple memory.

## Authority and identity

- CandidatePool records supply facts, evidence, and exact rejection codes. They do not change eligibility or scoring when copied into the session model.
- Provider source and place ID are the preferred identity. A verified plan place ID is the next choice. A fallback requires name, location, and category; name alone never merges two venues.
- The current plan determines selected items. Comparing the prior selected set with the current plan records replacements. Only a candidate uniquely matched to an actual displayed stop gets a `shown` event.
- Candidate facts retain the turn and observation time. Evidence retains its original source, retrieval time, verification level, and the turn when the session saw it. A historical fact is not treated as a fresh lookup.
- Historical candidate references can identify a unique shown venue or recorded rejection. Only explanation tasks may use those session targets. Mutation and venue inspection still require their existing application-state checks.

## Bounds and degradation

The context retains at most 80 candidates, three fact versions, six evidence items, and twelve events per candidate. When the session grows, selected items, reasoned rejections, and shown items have priority over unseen candidates. The serialized read model is bounded to 250,000 characters. Opening hours, reservations, event dates, and prices become stale after one day; other evidence after thirty days. No automatic revalidation occurs.

Malformed, oversized, unsigned, or altered context is ignored. The primary route and its result continue normally. The `candidate_session` observation and development log contain counts only. `getReusableCandidates` exposes shown, selected, rejected, unseen eligible, and stale groups for a future task executor; it performs no search or ranking.

The context is limited to the mounted planning session. Reloading the editor clears it. A future `recommend_places` executor must still define its own coverage, freshness recheck, and candidate verification policy before it may act on this history.
