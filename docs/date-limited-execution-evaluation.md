# Limited Date Task Evaluation (6-I)

## Scope and reproducibility

- Thirteen Korean conversation fixtures cover one-goal requests, follow-up recommendations, comparison, feedback, edits, combined requests, an ambiguous reference, stale hours, and hard constraints. Expected outcomes are goal/task types and facts, not sentence matches.
- `npx vitest run src/features/ai/evaluation/dateLimitedHarness.test.ts` runs the fixed-pool and structural checks without a network call. `DATE_EVAL_REPORT=true` with `--reporter=verbose --silent=false` prints an aggregate legacy-only baseline.
- `DATE_EVAL_LIVE=true npx tsx --tsconfig tsconfig.json scripts/evaluate-limited-date-live.ts` is a separate, opt-in OpenAI probe. `DATE_EVAL_INTERPRETER_ONLY=true` limits it to three interpreter calls. It prints IDs, counts and timings, not complete user messages or model responses.

## Metrics

The harness records goal and planned/fulfilled task coverage; unresolved references; duplicate successful task IDs, response lines and source URLs; known candidate hard-constraint violations; unsupported comparison facts; stale time-sensitive evidence used in comparison; repetition of shown candidates; missing expected feedback; failed dependency handling; primary result preservation; and independent tasks blocked by a separate plan issue. A zero count means no violation was observed in supplied verified fixtures; it is not proof about unseen model outputs.

## Findings

- The 13-fixture **legacy-only** understanding baseline represented 12 of 19 expected goals and 12 of 19 expected tasks. Seven scenarios had a missing goal. This measures the old parser without the ASSIST LLM, not production ASSIST accuracy.
- A fixed candidate pool kept shown A/B out of a follow-up recommendation, passed A's verified negative noise feedback as a soft signal, and removed an over-budget candidate under the current hard constraint. Comparing A/B with no noise evidence and stale opening hours returned unknown.
- A primary parking answer could be repeated verbatim by supplementary inspection. Exact repeated lines are now suppressed. A duplicate place card is skipped. Supplementary sections now follow the plan's stated execution order while executor dependency order remains unchanged.
- An unrelated unresolved task no longer blocks a verified comparison. Per-task validation and dependency isolation are covered by the execution-plan and dispatcher tests.
- A small live probe (five high-level calls) initially recognized five of six expected goal types, but emitted unsupported semantic labels (`location`, `noise level`). The existing approval gate rejected them. After adding exact taxonomy guidance to the interpreter prompt, an interpreter-only three-call probe recognized all six expected goals, accepted `pace`, and accepted attribute-level `noise` feedback. Its derived noise preference was rejected as ungrounded, as designed.
- In the live fixed-pool selector probe, a noise feedback signal about A changed the selected five from A–E to B–F; no unsupported noise sentence appeared in the generated cards. This is one small observation, not a measured recommendation-quality improvement or a guarantee across model versions.

## Limits and next gate

The live script counts high-level application calls, not internal HTTP retries or billable tokens. It does not evaluate course-proposal quality, route feasibility, or factual accuracy beyond the fixed supplied evidence. The `create_itinerary` task should remain shadow until per-task isolation, target/dependency consistency, and a broader labeled live evaluation are in place. ChatRoute and deterministic verification remain the actual authorities.
