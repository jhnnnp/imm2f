import { getOpenAiApiKey, getOpenAiModel, isOpenAiConfigured } from "./env";

export type PreferencePlaceInput = {
  name: string;
  categoryLabel: string;
  district: string;
  durationMinutes: number;
  userStatus: string;
  partnerStatus: string;
  userRated?: boolean;
  partnerRated?: boolean;
};

export type PreferenceDifference = {
  you: string;
  partner: string;
  bridge: string;
};

export type PreferenceRecommendation = {
  title: string;
  description: string;
  reason: string;
};

export type PreferenceInsight = {
  summary: string;
  youHighlights: string[];
  partnerHighlights: string[];
  commonTastes: Array<{ label: string; score: number }>;
  matchScore: number;
  differences: PreferenceDifference[];
  recommendations: PreferenceRecommendation[];
  note: string;
  sourceCount: number;
  confidence: number;
  evidence: {
    youRatedCount: number;
    partnerRatedCount: number;
    sharedPositivePlaceCount: number;
    unratedCount: number;
  };
  perspectiveUserId?: string;
};

type AnalyzePayload = {
  summary?: string;
  youHighlights?: string[];
  partnerHighlights?: string[];
  commonTastes?: Array<{ label?: string; score?: number }>;
  matchScore?: number;
  differences?: Array<{ you?: string; partner?: string; bridge?: string }>;
  recommendations?: Array<{ title?: string; description?: string; reason?: string }>;
};

const POSITIVE = new Set(["want", "must_visit", "revisit"]);
const STATUS_WEIGHT: Record<string, number> = {
  must_visit: 1,
  revisit: 1,
  want: 0.8,
  visited: 0.25,
  neutral: 0,
  dislike: -0.8,
  not_interested: -1,
};

function countBy(
  places: PreferencePlaceInput[],
  whose: "user" | "partner",
  pick: (place: PreferencePlaceInput) => string,
) {
  const counts = new Map<string, number>();
  for (const place of places) {
    const rated = whose === "user" ? place.userRated : place.partnerRated;
    const status = whose === "user" ? place.userStatus : place.partnerStatus;
    if (!rated || !POSITIVE.has(status)) continue;
    const key = pick(place).trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function topLabels(entries: Array<[string, number]>, limit = 3) {
  return entries.slice(0, limit).map(([label]) => label);
}

export function calculatePreferenceInsight(places: PreferencePlaceInput[]): PreferenceInsight {
  const userCats = countBy(places, "user", place => place.categoryLabel);
  const partnerCats = countBy(places, "partner", place => place.categoryLabel);
  const userDistricts = countBy(places, "user", place => place.district);
  const partnerDistricts = countBy(places, "partner", place => place.district);
  const youRatedCount = places.filter(place => place.userRated).length;
  const partnerRatedCount = places.filter(place => place.partnerRated).length;
  const sharedPositivePlaceCount = places.filter(place => place.userRated && place.partnerRated && POSITIVE.has(place.userStatus) && POSITIVE.has(place.partnerStatus)).length;
  const jointlyRated = places.filter(place => place.userRated && place.partnerRated);
  const agreement = jointlyRated.length
    ? jointlyRated.reduce((sum, place) => sum + (1 - Math.min(2, Math.abs((STATUS_WEIGHT[place.userStatus] ?? 0) - (STATUS_WEIGHT[place.partnerStatus] ?? 0))) / 2), 0) / jointlyRated.length
    : 0;

  const youHighlights = [
    ...topLabels(userCats, 2),
    ...topLabels(userDistricts, 1),
  ].filter(Boolean).slice(0, 3);
  const partnerHighlights = [
    ...topLabels(partnerCats, 2),
    ...topLabels(partnerDistricts, 1),
  ].filter(Boolean).slice(0, 3);

  const commonMap = new Map<string, number>();
  for (const [label, userCount] of userCats) {
    const partnerCount = partnerCats.find(([key]) => key === label)?.[1] ?? 0;
    if (!partnerCount) continue;
    commonMap.set(label, userCount + partnerCount);
  }
  const max = Math.max(1, ...commonMap.values());
  const commonTastes = [...commonMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, score: Math.max(55, Math.round((count / max) * 92)) }));

  const summary = sharedPositivePlaceCount > 0
    ? "두 사람이 모두 긍정적으로 표시한 장소를 중심으로, 실제로 겹치는 카테고리와 지역을 정리했어요."
    : "아직 두 사람의 긍정 응답이 충분히 겹치지 않았어요. 각자 몇 곳씩 더 표시하면 공통 취향을 더 정확하게 찾을 수 있어요.";

  const youPrimary = youHighlights[0] ?? "편안한 장소";
  const partnerPrimary = partnerHighlights[0] ?? "새로운 장소";
  const sharedPrimary = commonTastes[0]?.label ?? "각자 긍정 표시한 조건";
  const categoryLabels = new Set([...userCats.map(([label]) => label), ...partnerCats.map(([label]) => label)]);
  const categoryOverlap = categoryLabels.size
    ? [...categoryLabels].filter(label => userCats.some(([key]) => key === label) && partnerCats.some(([key]) => key === label)).length / categoryLabels.size
    : 0;
  const matchScore = jointlyRated.length
    ? Math.round((agreement * 0.65 + categoryOverlap * 0.35) * 100)
    : 0;
  const confidence = Math.min(100, Math.round((Math.min(youRatedCount, partnerRatedCount) / 8) * 100));
  const unratedCount = places.filter(place => !place.userRated || !place.partnerRated).length;

  return {
    summary,
    youHighlights: youHighlights.length ? youHighlights : ["아직 표시할 취향이 적어요"],
    partnerHighlights: partnerHighlights.length ? partnerHighlights : ["파트너 기록이 아직 적어요"],
    commonTastes,
    matchScore,
    differences: [{
      you: `${youPrimary} 쪽에 더 마음이 가요`,
      partner: `${partnerPrimary} 쪽을 더 자주 골라요`,
      bridge: `${sharedPrimary}를 중심에 두면 두 취향이 자연스럽게 만나요`,
    }],
    recommendations: [
      {
        title: "둘 다 편안한 선택",
        description: `${sharedPrimary} 분위기가 느껴지는 곳`,
        reason: commonTastes.length ? "둘의 긍정 기록에서 가장 자주 겹친 취향이에요." : "공통 취향 데이터가 쌓이기 전까지 두 사람의 긍정 조건을 함께 확인해요.",
      },
      {
        title: "서로의 취향을 섞은 선택",
        description: `${youPrimary}의 매력과 ${partnerPrimary}의 매력을 함께 가진 곳`,
        reason: "한 사람에게만 맞추지 않고 두 취향을 한 번에 경험해요.",
      },
    ],
    note: places.length < 4
      ? "현재 저장된 기록이 적어 이번 요약은 입력·저장 장소를 중심으로 구성했어요."
      : `저장된 장소 ${places.length}곳을 바탕으로 정리했어요.`,
    sourceCount: places.length,
    confidence,
    evidence: { youRatedCount, partnerRatedCount, sharedPositivePlaceCount, unratedCount },
  };
}

function sanitizeList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const next = value.map(item => String(item ?? "").trim()).filter(Boolean).slice(0, 4);
  return next.length ? next : fallback;
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
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenAiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        temperature: 0.3,
        response_format: { type: "json_object" },
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
      }),
    });
    if (!response.ok) return fallback;

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as AnalyzePayload;
    const differences = (parsed.differences ?? [])
      .map(item => ({
        you: String(item.you ?? "").trim().slice(0, 80),
        partner: String(item.partner ?? "").trim().slice(0, 80),
        bridge: String(item.bridge ?? "").trim().slice(0, 120),
      }))
      .filter(item => item.you && item.partner && item.bridge)
      .slice(0, 2);
    const recommendations = (parsed.recommendations ?? [])
      .map(item => ({
        title: String(item.title ?? "").trim().slice(0, 40),
        description: String(item.description ?? "").trim().slice(0, 100),
        reason: String(item.reason ?? "").trim().slice(0, 120),
      }))
      .filter(item => item.title && item.description && item.reason)
      .slice(0, 3);

    return {
      summary: String(parsed.summary ?? "").trim().slice(0, 280) || fallback.summary,
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
