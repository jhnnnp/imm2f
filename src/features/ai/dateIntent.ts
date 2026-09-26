import type { AIPlannerState } from "@/features/planning/types/plan";

export type DatePreferences = NonNullable<AIPlannerState["preferences"]>;
export type InferredPreference = NonNullable<AIPlannerState["inferredPreferences"]>[number];

export type DateIntent = {
  objective: string;
  hardConstraints: {
    areas: string[];
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    budgetWon: number | null;
    requiredPlaces: string[];
    excludedPlaces: string[];
    excludedFoods: string[];
    requiredActivities: AIPlannerState["activities"];
  };
  preferences: DatePreferences;
  inferredPreferences: InferredPreference[];
  memorySuggestions: NonNullable<AIPlannerState["memorySuggestions"]>;
  memorySignals: NonNullable<AIPlannerState["memorySignals"]>;
};

export function toDateIntent(state: AIPlannerState): DateIntent {
  return {
    objective: state.objective ?? "요청한 조건에 맞는 데이트 코스",
    hardConstraints: {
      areas: [...state.areas], date: state.dateLabel, startTime: state.startTime,
      endTime: state.endTime, budgetWon: state.budgetWon ?? null,
      requiredPlaces: [...state.requiredPlaces], excludedPlaces: [...state.excludedPlaces],
      excludedFoods: [...(state.excludedFoods ?? [])], requiredActivities: [...state.activities],
    },
    preferences: state.preferences ?? { vibe: [] },
    inferredPreferences: state.inferredPreferences ?? [],
    memorySuggestions: state.memorySuggestions ?? { activities: [], cuisine: null },
    memorySignals: state.memorySignals ?? [],
  };
}

const FOOD_TERMS = ["해산물", "갑각류", "새우", "꽃게", "조개", "굴요리", "생선", "회요리", "육류", "돼지고기", "소고기", "닭고기", "유제품", "우유", "치즈", "견과류", "땅콩", "밀가루", "글루텐"];
const dislike = /못\s*먹|안\s*먹|먹지\s*못|싫|알레르기|피하|제외|빼\s*줘|없이/;

/** Only the user's words can establish a food prohibition. */
export function explicitFoodExclusions(message: string) {
  return FOOD_TERMS.filter(food => {
    const index = message.indexOf(food);
    if (index < 0) return false;
    return dislike.test(message.slice(Math.max(0, index - 16), index + food.length + 18));
  });
}

export function candidateFoodConflict(text: string, exclusions: string[]) {
  const normalized = text.replace(/\s/g, "");
  return exclusions.some(food => {
    if (normalized.includes(food)) return true;
    if (food === "해산물") return /갑각류|새우|게장|조개|굴|생선|횟집|초밥|스시|오마카세|해물|씨푸드|봉골레/.test(normalized);
    if (food === "갑각류") return /새우|게장|킹크랩|랍스터/.test(normalized);
    if (food === "유제품") return /우유|치즈|크림|버터/.test(normalized);
    if (food === "견과류") return /땅콩|아몬드|호두|캐슈/.test(normalized);
    return false;
  });
}

export function explicitlyDislikedActivities(message: string): AIPlannerState["activities"] {
  const patterns: Array<[AIPlannerState["activities"][number], RegExp]> = [
    ["cafe", /(?:카페|커피|디저트)(?:는|가|를|도|만)?\s*.{0,8}(?:싫|별로|안\s*좋아|빼|제외)/],
    ["meal", /(?:식사|식당|밥)(?:는|가|를|도|만)?\s*.{0,8}(?:싫|별로|안\s*좋아|빼|제외)/],
    ["walk", /(?:산책|걷기)(?:는|가|를|도|만)?\s*.{0,8}(?:싫|별로|안\s*좋아|빼|제외)/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(message)).map(([activity]) => activity);
}

/** A conservative local fallback when the model is unavailable. */
export function deriveDateUnderstanding(message: string) {
  const preferences: Partial<DatePreferences> = {};
  const inferredPreferences: InferredPreference[] = [];
  const add = (value: string, evidence: string, confidence: number) =>
    inferredPreferences.push({ value, evidence, confidence });
  const quiet = message.match(/조용(?:하게|히|한)?|한적(?:하게|한)?|둘이\s*대화/);
  if (quiet) {
    preferences.crowdTolerance = 0.2;
    preferences.vibe = ["조용한"];
    add("붐비지 않고 대화하기 좋은 장소 선호", quiet[0], 0.85);
  }
  const novel = message.match(/뻔한\s*(?:건|곳|코스)?\s*싫|색다른|새로운\s*곳/);
  if (novel) {
    preferences.novelty = 0.85;
    add("익숙한 코스보다 새로운 경험 선호", novel[0], 0.8);
  }
  const reunion = message.match(/오랜만에\s*만나|오랜만에\s*보|재회/);
  if (reunion) {
    preferences.intimacy = 0.85;
    preferences.activityLevel = 0.35;
    add("대화 중심의 편안한 데이트 선호", reunion[0], 0.7);
  }
  const photo = message.match(/사진\s*찍|포토\s*스팟|인생샷/);
  if (photo) {
    preferences.vibe = [...new Set([...(preferences.vibe ?? []), "사진 찍기 좋은"])];
    add("사진을 남길 만한 공간 선호", photo[0], 0.8);
  }
  const food = message.match(/맛집\s*(?:위주|중심)|음식이\s*중요|먹는\s*게\s*중요|미식\s*데이트/);
  if (food) {
    preferences.foodImportance = 0.85;
    add("식사 경험을 중요하게 생각함", food[0], 0.8);
  }
  const shortWalk = message.match(/많이\s*걷(?:는\s*건|기)?\s*(?:싫|힘들)|도보\s*(?:짧게|최소)|걷기\s*힘들/);
  if (shortWalk) {
    preferences.walkingTolerance = 0.2;
    add("긴 도보 이동을 피하고 싶음", shortWalk[0], 0.85);
  }
  const objective = reunion ? "오랜만의 만남을 편안하게 즐기는 데이트"
    : quiet ? "조용히 대화할 수 있는 데이트"
      : novel ? "새로운 경험이 있는 데이트" : undefined;
  return { objective, preferences, inferredPreferences };
}

export function sanitizeDatePreferences(value: unknown): Partial<DatePreferences> | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const result: Partial<DatePreferences> = {};
  if (raw.vibe !== undefined) {
    if (!Array.isArray(raw.vibe) || !raw.vibe.every(item => typeof item === "string")) return null;
    result.vibe = [...new Set(raw.vibe.map(item => item.trim().slice(0, 40)).filter(Boolean))].slice(0, 5);
  }
  for (const key of ["novelty", "intimacy", "activityLevel", "crowdTolerance", "scenicPreference", "foodImportance", "walkingTolerance"] as const) {
    if (raw[key] === undefined || raw[key] === null) continue;
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0 || raw[key] > 1) return null;
    result[key] = raw[key];
  }
  return result;
}

export function sanitizeInferredPreferences(value: unknown, message: string): InferredPreference[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const compact = message.replace(/\s/g, "").toLowerCase();
  const result: InferredPreference[] = [];
  for (const item of value.slice(0, 5)) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (typeof row.value !== "string" || typeof row.evidence !== "string"
      || typeof row.confidence !== "number" || !Number.isFinite(row.confidence)
      || row.confidence < 0 || row.confidence > 1) return null;
    const evidence = row.evidence.trim();
    // The cited cue must occur in this user turn, rather than in a playbook example.
    if (!evidence || !compact.includes(evidence.replace(/\s/g, "").toLowerCase())) continue;
    result.push({ value: row.value.trim().slice(0, 80), evidence: evidence.slice(0, 80), confidence: row.confidence });
  }
  return result;
}
