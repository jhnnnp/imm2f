/** Opt-in development probe. Never imported by the test suite or production route. */
import { loadEnvConfig } from "@next/env";
import { emptyDateBrief, withAreas } from "../src/features/ai/dateBrief";
import { buildEffectiveDateTurnUnderstanding } from "../src/features/ai/dateTurnAssist";
import { toDateIntent } from "../src/features/ai/dateIntent";
import { normalizeDateTurnPayload } from "../src/features/ai/dateTurnShadow";
import { buildDateTurnUnderstanding } from "../src/features/ai/dateTurnUnderstanding";
import { buildSemanticPlanningHints } from "../src/features/ai/semanticPlanningHints";
import type { DiscoverCandidate } from "../src/features/places/types/place";
import { interpretDateTurnWithOpenAi } from "../src/lib/openai/dateTurnInterpreter";
import { isOpenAiConfigured } from "../src/lib/openai/env";
import { recommendPlacesWithOpenAi } from "../src/lib/openai/recommendPlaces";

async function main() {
  if (process.env.DATE_EVAL_LIVE !== "true") {
    process.stdout.write("Set DATE_EVAL_LIVE=true to run the opt-in model probe.\n");
    return;
  }
  loadEnvConfig(process.cwd());
  if (!isOpenAiConfigured()) {
    process.stdout.write("OpenAI key unavailable; live probe skipped.\n");
    return;
  }
  const state = withAreas(emptyDateBrief(), ["성수"]);
  const cases = [
    { id: "pace", message: "성수에서 좀 더 여유로운 데이트 코스 짜줘",
      expectedGoals: ["create_itinerary"] },
    { id: "feedback_recommend", message: "아까 카페는 너무 시끄러웠어. 다른 카페 추천해줘",
      expectedGoals: ["provide_feedback", "recommend_places"] },
    { id: "three_goals", message: "저녁 바꿔주고 지금 카페 주차 확인하고 다른 카페도 추천해줘",
      expectedGoals: ["modify_itinerary", "ask_venue", "recommend_places"] },
  ] as const;
  let highLevelCallCount = 0;
  const understanding = [];
  for (const scenario of cases) {
    const start = performance.now();
    highLevelCallCount += 1;
    const payload = await interpretDateTurnWithOpenAi({ message: scenario.message, state,
      visiblePlaces: ["카페 A"] });
    if (!payload) {
      understanding.push({ id: scenario.id, valid: false,
        latencyMs: Math.round(performance.now() - start) });
      continue;
    }
    const legacy = buildDateTurnUnderstanding({ message: scenario.message, state,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
      visiblePlaces: ["카페 A"] });
    const llm = normalizeDateTurnPayload(payload, { message: scenario.message,
      visiblePlaces: ["카페 A"], legacy });
    const effective = buildEffectiveDateTurnUnderstanding({ legacy, llm,
      hardConstraints: toDateIntent(state).hardConstraints, currentPlan: null,
      visiblePlaces: ["카페 A"] });
    const goals = new Set(llm.goals.map(goal => goal.type));
    understanding.push({ id: scenario.id, valid: true,
      goalCoverage: scenario.expectedGoals.filter(goal => goals.has(goal)).length,
      expectedGoals: scenario.expectedGoals.length,
      goalTypes: [...goals],
      llmSemanticDimensions: llm.semanticPreferences.map(item => ({ dimension: item.dimension,
        confidence: item.confidence })),
      semanticDecisions: effective.semanticSignals.map(item => ({ dimension: item.dimension,
        accepted: item.accepted, reason: item.rejectionReason ?? null })),
      approvedSemanticDimensions: Object.keys(buildSemanticPlanningHints(effective.effectiveUnderstanding)),
      llmFeedbackAttributes: llm.feedback.map(item => item.attribute ?? "unknown"),
      approvedFeedbackCount: effective.acceptedFeedbackCount,
      unresolvedReferenceCount: llm.references.filter(ref => ref.kind === "unresolved").length,
      latencyMs: Math.round(performance.now() - start) });
  }

  if (process.env.DATE_EVAL_INTERPRETER_ONLY === "true") {
    process.stdout.write(`${JSON.stringify({ highLevelCallCount, understanding, recommendation: [] })}\n`);
    return;
  }

  const candidates: DiscoverCandidate[] = ["A", "B", "C", "D", "E", "F"].map((id, index) => ({
    externalSource: "kakao", externalPlaceId: id, name: `카페 ${id}`,
    category: "cafe", categoryLabel: "카페", kakaoCategoryGroupCode: "CE7", district: "성수",
    address: `서울 성수 ${index + 1}`, roadAddress: `서울 성수 ${index + 1}`,
    phone: "", mapUrl: "", coordinates: [127.04 + index * 0.001, 37.56], searchRegion: "성수",
  }));
  const recommendation = [];
  for (const scenario of [{ id: "baseline", feedback: false }, { id: "noise_feedback", feedback: true }]) {
    const start = performance.now();
    highLevelCallCount += 1;
    const response = await recommendPlacesWithOpenAi({ message: "성수 카페 추천해줘",
      ask: { kind: "cafe", query: "카페", area: "성수" }, candidates,
      savedNames: new Set(), bothWant: new Set(), coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] },
      alreadyShown: [], skipFactLookup: true,
      ...(scenario.feedback ? { sessionFeedbackSignals: [{ attribute: "noise",
        sentiment: "negative" as const, targetName: "카페 A", targetCandidateId: "kakao:A",
        priority: "current_feedback" as const }] } : {}),
    });
    recommendation.push({ id: scenario.id, source: response.source,
      selectedNames: response.card.stops?.map(stop => stop.name) ?? [],
      unsupportedNoiseClaimCount: (response.card.lines ?? []).filter(line =>
        /조용|시끄러/.test(line)).length,
      latencyMs: Math.round(performance.now() - start) });
  }
  process.stdout.write(`${JSON.stringify({ highLevelCallCount, understanding, recommendation })}\n`);
}

void main().catch(error => {
  process.stderr.write(`Live evaluation failed: ${error instanceof Error ? error.name : "unknown"}\n`);
  process.exitCode = 1;
});
