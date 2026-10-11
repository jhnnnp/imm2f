import "server-only";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";
import { calculatePreferenceInsight, type PreferenceInsight, type PreferencePlaceInput } from "./preferenceInsight";

export { calculatePreferenceInsight } from "./preferenceInsight";
export type { PreferenceInsight, PreferencePlaceInput, PreferenceDifference, PreferenceRecommendation } from "./preferenceInsight";

type AnalyzePayload = {
  summary?: string;
  youHighlights?: string[];
  partnerHighlights?: string[];
  commonTastes?: Array<{ label?: string; score?: number }>;
  matchScore?: number;
  differences?: Array<{ you?: string; partner?: string; bridge?: string }>;
  recommendations?: Array<{ title?: string; description?: string; reason?: string }>;
};

function boundedText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function analyzePreferencesWithOpenAi(input: {
  places: PreferencePlaceInput[];
  youName: string;
  partnerName: string;
}): Promise<PreferenceInsight | { error: string }> {
  if (!input.places.length) {
    return {
      error: "분석할 장소가 없어요. Places에서 장소를 먼저 저장해 주세요.",
    };
  }

  const fallback = calculatePreferenceInsight(input.places);
  if (!isOpenAiConfigured()) {
    return { ...fallback, note: `${fallback.note} OpenAI 키가 없어 규칙 기반 요약이에요.` };
  }

  const sample = input.places.slice(0, 40).map(place => ({
    name: place.name,
    category: place.categoryLabel,
    district: place.district,
    you: place.userRated ? place.userStatus : "unrated",
    partner: place.partnerRated ? place.partnerStatus : "unrated",
  }));

  try {
    const parsed = await completeJson<AnalyzePayload>({
      temperature: 0.3,
      maxTokens: 2500,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: [
            "You summarize a couple's place preferences from saved place states only.",
            "Never invent places, addresses, prices, distances, ratings, or visit counts not implied by the data.",
            "Reply Korean JSON:",
            '{"summary":"2-3 Korean sentences","differences":[{"you":"...","partner":"...","bridge":"..."}],"recommendations":[{"title":"...","description":"...","reason":"..."}]}',
            "The server already calculated scores and taste labels. Do not calculate or output scores.",
            "unrated means no response, never describe it as neutral or dislike.",
            "Do not discuss price. differences compare category, mood, area, activity, or pace. recommendations describe place conditions, never invent venue names.",
          ].join(" "),
        },
        {
          role: "user",
          content: `${input.youName} / ${input.partnerName}\n검증된 통계:\n${JSON.stringify({ matchScore: fallback.matchScore, confidence: fallback.confidence, commonTastes: fallback.commonTastes, evidence: fallback.evidence, youHighlights: fallback.youHighlights, partnerHighlights: fallback.partnerHighlights })}\n장소 기록:\n${JSON.stringify(sample)}`,
        },
      ],
    });
    if (!parsed) return fallback;
    const differences = (Array.isArray(parsed.differences) ? parsed.differences : [])
      .filter((item): item is NonNullable<typeof item> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map(item => ({
        you: boundedText(item.you, 80),
        partner: boundedText(item.partner, 80),
        bridge: boundedText(item.bridge, 120),
      }))
      .filter(item => item.you && item.partner && item.bridge)
      .slice(0, 2);
    const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .filter((item): item is NonNullable<typeof item> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map(item => ({
        title: boundedText(item.title, 40),
        description: boundedText(item.description, 100),
        reason: boundedText(item.reason, 120),
      }))
      .filter(item => item.title && item.description && item.reason)
      .slice(0, 3);

    return {
      summary: boundedText(parsed.summary, 280) || fallback.summary,
      youHighlights: fallback.youHighlights,
      partnerHighlights: fallback.partnerHighlights,
      commonTastes: fallback.commonTastes,
      matchScore: fallback.matchScore,
      differences: differences.length ? differences : fallback.differences,
      recommendations: recommendations.length ? recommendations : fallback.recommendations,
      note: fallback.note,
      sourceCount: input.places.length,
      confidence: fallback.confidence,
      evidence: fallback.evidence,
    };
  } catch {
    return fallback;
  }
}
