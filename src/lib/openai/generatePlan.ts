import type { PlanItem, PlanKind, PlanOption, PlanOptionStyle } from "@/features/planning/types/plan";
import { getOpenAiApiKey, getOpenAiModel, isOpenAiConfigured } from "./env";

export type PlanPlaceInput = {
  id: string;
  name: string;
  categoryLabel: string;
  district: string;
  durationMinutes: number;
  expectedCostTwo: number | null;
  userStatus: string;
  partnerStatus: string;
};

type RawOption = {
  key?: string;
  style?: string;
  title?: string;
  summary?: string;
  items?: Array<{
    place_id?: string;
    start_time?: string;
    duration_minutes?: number;
    memo?: string;
  }>;
};

type GeneratePayload = {
  options?: RawOption[];
};

const STYLE_META: Record<PlanOptionStyle, { key: "A" | "B" | "C"; label: string }> = {
  balanced: { key: "A", label: "균형형" },
  relaxed: { key: "B", label: "여유형" },
  budget: { key: "C", label: "가성비형" },
};

function parseTime(value: string | undefined, fallback: string) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return fallback;
  const [h, m] = raw.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clampMinutes(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(30, Math.min(240, Math.round(n / 10) * 10));
}

function normalizeStyle(value: unknown): PlanOptionStyle | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "balanced" || raw === "a" || raw.includes("균형")) return "balanced";
  if (raw === "relaxed" || raw === "b" || raw.includes("여유")) return "relaxed";
  if (raw === "budget" || raw === "c" || raw.includes("가성") || raw.includes("예산")) return "budget";
  return null;
}

function buildItems(
  kind: PlanKind,
  style: PlanOptionStyle,
  rawItems: NonNullable<RawOption["items"]>,
  places: Map<string, PlanPlaceInput>,
): PlanItem[] {
  const defaultStart = kind === "date" ? "15:00" : "09:30";
  const minCount = kind === "date" ? 2 : 3;
  const maxCount = kind === "date" ? 4 : 6;
  const seen = new Set<string>();
  const items: PlanItem[] = [];

  for (const row of rawItems ?? []) {
    const placeId = String(row.place_id ?? "");
    const place = places.get(placeId);
    if (!place || seen.has(placeId)) continue;
    seen.add(placeId);
    const durationMinutes = clampMinutes(row.duration_minutes, place.durationMinutes || 60);
    items.push({
      id: `ai-${kind}-${style}-${place.id}`,
      placeId: place.id,
      placeName: place.name,
      category: place.categoryLabel,
      startTime: parseTime(row.start_time, defaultStart),
      durationMinutes,
      expectedCost: place.expectedCostTwo ?? 0,
      order: items.length,
      memo: String(row.memo ?? "").trim().slice(0, 80),
      dayIndex: 0,
    });
    if (items.length >= maxCount) break;
  }

  if (items.length < minCount) return [];

  const sequenced: PlanItem[] = [];
  let cursor = items[0]?.startTime ?? defaultStart;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index === 0) {
      sequenced.push({ ...item, order: 0, startTime: cursor, dayIndex: item.dayIndex ?? 0 });
      continue;
    }
    const prev = sequenced[index - 1];
    const [hours, minutes] = cursor.split(":").map(Number);
    const total = (hours || 0) * 60 + (minutes || 0) + (prev?.durationMinutes || 60) + 20;
    cursor = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    sequenced.push({ ...item, order: index, startTime: cursor, dayIndex: item.dayIndex ?? 0 });
  }
  return sequenced;
}

function toOption(
  kind: PlanKind,
  style: PlanOptionStyle,
  raw: RawOption | undefined,
  places: Map<string, PlanPlaceInput>,
): PlanOption | null {
  const meta = STYLE_META[style];
  const items = buildItems(kind, style, raw?.items ?? [], places);
  if (!items.length) return null;
  const totalCost = items.reduce((sum, item) => sum + item.expectedCost, 0);
  return {
    key: meta.key,
    style,
    styleLabel: meta.label,
    title: String(raw?.title ?? meta.label).trim().slice(0, 40) || meta.label,
    summary: String(raw?.summary ?? "").trim().slice(0, 120)
      || `${meta.label}으로 ${items.length}곳을 이었어요.`,
    items,
    totalCost,
    placeCount: items.length,
  };
}

function heuristicOptions(kind: PlanKind, places: PlanPlaceInput[]): PlanOption[] {
  const ranked = [...places].sort((a, b) => {
    const score = (place: PlanPlaceInput) => {
      let value = 0;
      if (["want", "must_visit", "revisit"].includes(place.userStatus)) value += 2;
      if (["want", "must_visit", "revisit"].includes(place.partnerStatus)) value += 2;
      if (place.expectedCostTwo == null) value += 1;
      return value;
    };
    return score(b) - score(a);
  });
  const map = new Map(ranked.map(place => [place.id, place]));
  const take = (count: number, preferCheap: boolean) => {
    const pool = preferCheap
      ? [...ranked].sort((a, b) => (a.expectedCostTwo ?? 0) - (b.expectedCostTwo ?? 0))
      : ranked;
    return pool.slice(0, count).map((place, index) => ({
      place_id: place.id,
      start_time: kind === "date" ? "15:00" : "09:30",
      duration_minutes: preferCheap ? Math.max(40, Math.min(90, place.durationMinutes || 60)) : (place.durationMinutes || 60) + (index === pool.length - 1 ? 30 : 0),
      memo: "",
    }));
  };
  const count = kind === "date" ? Math.min(3, ranked.length) : Math.min(5, ranked.length);
  const relaxedCount = Math.max(kind === "date" ? 2 : 3, count - 1);
  const styles: PlanOptionStyle[] = ["balanced", "relaxed", "budget"];
  const rawByStyle: Record<PlanOptionStyle, RawOption> = {
    balanced: { style: "balanced", title: "균형형", summary: "저장된 장소를 고르게 이은 기본안이에요.", items: take(count, false) },
    relaxed: { style: "relaxed", title: "여유형", summary: "장소를 조금 줄이고 더 오래 머무는 안이에요.", items: take(relaxedCount, false) },
    budget: { style: "budget", title: "가성비형", summary: "예상 비용이 낮은 장소 위주로 구성했어요.", items: take(count, true) },
  };
  return styles.map(style => toOption(kind, style, rawByStyle[style], map)).filter((item): item is PlanOption => Boolean(item));
}

export async function generatePlanOptionsWithOpenAi(input: {
  kind: PlanKind;
  prompt: string;
  places: PlanPlaceInput[];
}): Promise<{ options: PlanOption[]; note: string } | { error: string }> {
  if (!input.places.length) {
    return { error: "저장된 장소가 없어요. Places에서 장소를 먼저 담아 주세요." };
  }
  if (input.places.length < 2) {
    return { error: "일정을 만들려면 장소가 2곳 이상 필요해요." };
  }

  const prompt = input.prompt.trim().slice(0, 400);
  const placeMap = new Map(input.places.map(place => [place.id, place]));
  const catalog = input.places.slice(0, 24).map(place => ({
    id: place.id,
    name: place.name,
    category: place.categoryLabel,
    district: place.district,
    durationMinutes: place.durationMinutes,
    expectedCostTwo: place.expectedCostTwo,
    userStatus: place.userStatus,
    partnerStatus: place.partnerStatus,
  }));
  const note = input.places.length < 4
    ? "현재 저장된 기록이 적어 이번 제안은 입력한 조건과 저장 장소를 중심으로 구성했어요."
    : "";

  if (!isOpenAiConfigured()) {
    const options = heuristicOptions(input.kind, input.places);
    if (!options.length) return { error: "일정을 만들지 못했어요. 장소를 더 저장해 주세요." };
    return { options, note: note || "OpenAI 키가 없어 규칙 기반으로 3안을 만들었어요." };
  }

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
              "You generate exactly 3 day-plan options for a couple using ONLY provided place ids.",
              "Never invent places, addresses, coordinates, distances, travel times, prices, or opening hours.",
              "Styles must be balanced, relaxed, budget (A/B/C).",
              "Each option items: place_id, start_time (HH:MM), duration_minutes (30-240), optional Korean memo.",
              `For ${input.kind === "date" ? "date: 2-4 places starting near 15:00" : "trip day: 3-6 places starting near 09:30"}.`,
              "Prefer want/must_visit/revisit. Avoid dislike/not_interested when alternatives exist.",
              "JSON: {\"options\":[{\"key\":\"A\",\"style\":\"balanced\",\"title\":\"...\",\"summary\":\"Korean one sentence\",\"items\":[...]}, ...]}",
            ].join(" "),
          },
          {
            role: "user",
            content: `계획 종류: ${input.kind}\n특별 요청: ${prompt || "없음"}\n후보 장소:\n${JSON.stringify(catalog)}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      const options = heuristicOptions(input.kind, input.places);
      if (!options.length) return { error: "AI 일정을 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
      return { options, note: note || "AI 응답이 불안정해 규칙 기반 3안으로 대체했어요." };
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as GeneratePayload;
    const byStyle = new Map<PlanOptionStyle, RawOption>();
    for (const row of parsed.options ?? []) {
      const style = normalizeStyle(row.style) ?? normalizeStyle(row.key);
      if (!style || byStyle.has(style)) continue;
      byStyle.set(style, row);
    }

    const options = (["balanced", "relaxed", "budget"] as PlanOptionStyle[])
      .map(style => toOption(input.kind, style, byStyle.get(style), placeMap))
      .filter((item): item is PlanOption => Boolean(item));

    if (options.length < 2) {
      const fallback = heuristicOptions(input.kind, input.places);
      if (!fallback.length) return { error: "유효한 일정 안을 만들지 못했어요." };
      return { options: fallback, note: note || "AI 결과를 보정하지 못해 규칙 기반 3안으로 대체했어요." };
    }

    return { options, note };
  } catch {
    const options = heuristicOptions(input.kind, input.places);
    if (!options.length) return { error: "AI 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요." };
    return { options, note: note || "AI 응답을 읽지 못해 규칙 기반 3안으로 대체했어요." };
  }
}
