import { getOpenAiApiKey, getOpenAiModel, isOpenAiConfigured } from "./env";

export type PreferencePlaceInput = {
  name: string;
  categoryLabel: string;
  district: string;
  durationMinutes: number;
  expectedCostTwo: number | null;
  userStatus: string;
  partnerStatus: string;
};

export type PreferenceInsight = {
  summary: string;
  youHighlights: string[];
  partnerHighlights: string[];
  commonTastes: Array<{ label: string; score: number }>;
  note: string;
  sourceCount: number;
};

type AnalyzePayload = {
  summary?: string;
  youHighlights?: string[];
  partnerHighlights?: string[];
  commonTastes?: Array<{ label?: string; score?: number }>;
};

const POSITIVE = new Set(["want", "must_visit", "revisit", "visited"]);

function clampScore(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function countBy(
  places: PreferencePlaceInput[],
  whose: "user" | "partner",
  pick: (place: PreferencePlaceInput) => string,
) {
  const counts = new Map<string, number>();
  for (const place of places) {
    const status = whose === "user" ? place.userStatus : place.partnerStatus;
    if (!POSITIVE.has(status)) continue;
    const key = pick(place).trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function topLabels(entries: Array<[string, number]>, limit = 3) {
  return entries.slice(0, limit).map(([label]) => label);
}

function heuristicInsight(places: PreferencePlaceInput[]): PreferenceInsight {
  const userCats = countBy(places, "user", place => place.categoryLabel);
  const partnerCats = countBy(places, "partner", place => place.categoryLabel);
  const userDistricts = countBy(places, "user", place => place.district);
  const partnerDistricts = countBy(places, "partner", place => place.district);
  const longStay = places.filter(place => place.durationMinutes >= 90 && (POSITIVE.has(place.userStatus) || POSITIVE.has(place.partnerStatus))).length;
  const freeish = places.filter(place => (place.expectedCostTwo ?? 0) === 0 && (POSITIVE.has(place.userStatus) || POSITIVE.has(place.partnerStatus))).length;

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
  if (longStay >= 2) commonMap.set("오래 머무르기", longStay);
  if (freeish >= 2) commonMap.set("가벼운 비용", freeish);

  const max = Math.max(1, ...commonMap.values());
  const commonTastes = [...commonMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, score: Math.max(55, Math.round((count / max) * 92)) }));

  if (!commonTastes.length && places.length) {
    commonTastes.push(
      { label: "함께 저장한 장소", score: Math.min(90, 50 + places.length * 4) },
      { label: "천천히 보기", score: longStay ? 78 : 62 },
    );
  }

  const summary = longStay >= 2
    ? "둘은 많은 곳을 빠르게 도는 여행보다, 좋아하는 장소에서 오래 머무는 리듬의 만족도가 높은 편이에요."
    : "아직 기록이 많지 않지만, 저장한 장소를 보면 익숙한 동네와 편한 카테고리를 함께 쌓아가고 있어요.";

  return {
    summary,
    youHighlights: youHighlights.length ? youHighlights : ["아직 표시할 취향이 적어요"],
    partnerHighlights: partnerHighlights.length ? partnerHighlights : ["파트너 기록이 아직 적어요"],
    commonTastes,
    note: places.length < 4
      ? "현재 저장된 기록이 적어 이번 요약은 입력·저장 장소를 중심으로 구성했어요."
      : `저장된 장소 ${places.length}곳을 바탕으로 정리했어요.`,
    sourceCount: places.length,
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

  const fallback = heuristicInsight(input.places);
  if (!isOpenAiConfigured()) {
    return { ...fallback, note: `${fallback.note} OpenAI 키가 없어 규칙 기반 요약이에요.` };
  }

  const sample = input.places.slice(0, 40).map(place => ({
    name: place.name,
    category: place.categoryLabel,
    district: place.district,
    durationMinutes: place.durationMinutes,
    expectedCostTwo: place.expectedCostTwo,
    you: place.userStatus,
    partner: place.partnerStatus,
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
              '{"summary":"2-3 Korean sentences","youHighlights":["..."],"partnerHighlights":["..."],"commonTastes":[{"label":"...","score":0-100}]}',
              "commonTastes: 3-4 short labels. Scores are soft preference indicators, not probabilities.",
            ].join(" "),
          },
          {
            role: "user",
            content: `${input.youName} / ${input.partnerName}\n장소 기록:\n${JSON.stringify(sample)}`,
          },
        ],
      }),
    });
    if (!response.ok) return fallback;

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as AnalyzePayload;
    const commonTastes = (parsed.commonTastes ?? [])
      .map(item => ({
        label: String(item.label ?? "").trim().slice(0, 24),
        score: clampScore(item.score),
      }))
      .filter(item => item.label)
      .slice(0, 4);

    return {
      summary: String(parsed.summary ?? "").trim().slice(0, 280) || fallback.summary,
      youHighlights: sanitizeList(parsed.youHighlights, fallback.youHighlights),
      partnerHighlights: sanitizeList(parsed.partnerHighlights, fallback.partnerHighlights),
      commonTastes: commonTastes.length ? commonTastes : fallback.commonTastes,
      note: fallback.note,
      sourceCount: input.places.length,
    };
  } catch {
    return fallback;
  }
}
