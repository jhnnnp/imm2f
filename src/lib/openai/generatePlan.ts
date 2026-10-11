import type { PlanItem, PlanKind, PlanOption, PlanOptionStyle } from "@/features/planning/types/plan";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

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
};

function parseTime(value: unknown, fallback: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return fallback;
  const [h, m] = raw.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clampMinutes(value: unknown, fallback: number) {
  const n = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.max(30, Math.min(240, Math.round(n / 10) * 10));
}

function normalizeStyle(value: unknown): PlanOptionStyle | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "balanced" || raw === "a" || raw.includes("균형")) return "balanced";
  if (raw === "relaxed" || raw === "b" || raw.includes("여유")) return "relaxed";
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

  for (const row of Array.isArray(rawItems) ? rawItems : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const placeId = typeof row.place_id === "string" ? row.place_id : "";
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
      expectedCost: 0,
      order: items.length,
      memo: typeof row.memo === "string" ? row.memo.trim().slice(0, 80) : "",
      dayIndex: 0,
    });
    if (items.length >= maxCount) break;
  }

  if (items.length < minCount) return [];

  const sequenced: PlanItem[] = [];
  const [startHours, startMinutes] = (items[0]?.startTime ?? defaultStart).split(":").map(Number);
  let cursor = startHours * 60 + startMinutes;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index > 0) cursor += sequenced[index - 1].durationMinutes + 20;
    // These are day plans. Midnight cannot silently wrap to an earlier time.
    if (cursor + item.durationMinutes >= 1440) return [];
    const startTime = `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
    sequenced.push({ ...item, order: index, startTime, dayIndex: 0 });
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
  const label = meta.label;
  return {
    key: meta.key,
    style,
    styleLabel: label,
    title: label,
    summary: style === "relaxed" ? `${items.length}곳에서 평균 ${Math.round(items.reduce((sum, item) => sum + item.durationMinutes, 0) / items.length)}분씩 머무는 안이에요.`
        : `${items.length}곳을 이은 일정 제안이에요.`,
    items,
    totalCost: 0,
    placeCount: items.length,
  };
}

function heuristicOptions(kind: PlanKind, places: PlanPlaceInput[]): PlanOption[] {
  const ranked = [...places].sort((a, b) => {
    const score = (place: PlanPlaceInput) => {
      let value = 0;
      if (["want", "must_visit", "revisit"].includes(place.userStatus)) value += 2;
      if (["want", "must_visit", "revisit"].includes(place.partnerStatus)) value += 2;
      return value;
    };
    return score(b) - score(a);
  });
  const map = new Map(ranked.map(place => [place.id, place]));
  const take = (count: number, style: PlanOptionStyle) => {
    return ranked.slice(0, count).map(place => ({
      place_id: place.id,
      start_time: kind === "date" ? "15:00" : "09:30",
      duration_minutes: style === "relaxed" ? Math.min(240, (place.durationMinutes || 60) + 30)
        : place.durationMinutes || 60,
      memo: "",
    }));
  };
  const count = kind === "date" ? Math.min(3, ranked.length) : Math.min(5, ranked.length);
  const relaxedCount = Math.max(kind === "date" ? 2 : 3, count - 1);
  const styles: PlanOptionStyle[] = ["balanced", "relaxed"];
  const rawByStyle: Record<PlanOptionStyle, RawOption> = {
    balanced: { style: "balanced", title: "균형형", summary: "저장된 장소를 고르게 이은 기본안이에요.", items: take(count, "balanced") },
    relaxed: { style: "relaxed", title: "여유형", summary: "장소를 조금 줄이고 더 오래 머무는 안이에요.", items: take(relaxedCount, "relaxed") },
  };
  const seen = new Set<string>();
  return styles.map(style => toOption(kind, style, rawByStyle[style], map)).filter((item): item is PlanOption => {
    if (!item) return false;
    const signature = item.items.map(stop => `${stop.placeId}:${stop.durationMinutes}`).join("|");
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export async function generatePlanOptionsWithOpenAi(input: {
  kind: PlanKind;
  prompt: string;
  places: PlanPlaceInput[];
}): Promise<{ options: PlanOption[]; note: string } | { error: string }> {
  if (!input.places.length) {
    return { error: "저장된 장소가 없어요. Places에서 장소를 먼저 담아 주세요." };
  }
  const minCount = input.kind === "trip" ? 3 : 2;
  const eligible = input.places.filter(place => !["dislike", "not_interested"].includes(place.userStatus)
    && !["dislike", "not_interested"].includes(place.partnerStatus));
  if (eligible.length < minCount) {
    return { error: `두 분이 피하고 싶은 장소를 제외하면 일정에 넣을 곳이 ${minCount}곳 미만이에요. 저장한 장소를 더 골라 주세요.` };
  }

  const prompt = input.prompt.trim().slice(0, 400);
  const available = eligible.slice(0, 24);
  const placeMap = new Map(available.map(place => [place.id, place]));
  const catalog = available.map(place => ({
    id: place.id,
    name: place.name,
    category: place.categoryLabel,
    district: place.district,
    durationMinutes: place.durationMinutes,
    userStatus: place.userStatus,
    partnerStatus: place.partnerStatus,
  }));
  const note = eligible.length < 4
    ? "현재 저장된 기록이 적어 이번 제안은 입력한 조건과 저장 장소를 중심으로 구성했어요."
    : "";

  if (!isOpenAiConfigured()) {
    const options = heuristicOptions(input.kind, available);
    if (!options.length) return { error: "일정을 만들지 못했어요. 장소를 더 저장해 주세요." };
    return { options, note: [note, `저장한 장소를 바탕으로 ${options.length}안을 만들었어요.`].filter(Boolean).join(" ") };
  }

  try {
    const parsed = await completeJson<GeneratePayload>({
      temperature: 0.3,
      maxTokens: 3500,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: [
            "You generate exactly 2 day-plan options for a couple using ONLY provided place ids.",
            "Never invent places, addresses, coordinates, distances, travel times, prices, or opening hours.",
            "Styles must be balanced and relaxed (A/B), differing in pace and stay durations. Do not use costs or budgets to rank venues or label a course.",
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
    });
    if (!parsed) {
      const options = heuristicOptions(input.kind, available);
      if (!options.length) return { error: "AI 일정을 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
      return { options, note: [note, `AI 응답이 불안정해 저장한 장소를 바탕으로 ${options.length}안을 만들었어요.`].filter(Boolean).join(" ") };
    }
    const byStyle = new Map<PlanOptionStyle, RawOption>();
    for (const row of Array.isArray(parsed.options) ? parsed.options : []) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const style = normalizeStyle(row.style) ?? normalizeStyle(row.key);
      if (!style || byStyle.has(style)) continue;
      byStyle.set(style, row);
    }

    const options = (["balanced", "relaxed"] as PlanOptionStyle[])
      .map(style => toOption(input.kind, style, byStyle.get(style), placeMap))
      .filter((item): item is PlanOption => Boolean(item));

    const signatures = new Set(options.map(option => option.items.map(item => `${item.placeId}:${item.durationMinutes}`).join("|")));
    if (options.length !== 2 || signatures.size !== 2) {
      const fallback = heuristicOptions(input.kind, available);
      if (!fallback.length) return { error: "유효한 일정 안을 만들지 못했어요." };
      return { options: fallback, note: [note, `AI 결과를 확인하지 못해 저장한 장소를 바탕으로 ${fallback.length}안을 만들었어요.`].filter(Boolean).join(" ") };
    }

    return { options, note };
  } catch {
    const options = heuristicOptions(input.kind, available);
    if (!options.length) return { error: "AI 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요." };
    return { options, note: [note, `AI 응답을 읽지 못해 저장한 장소를 바탕으로 ${options.length}안을 만들었어요.`].filter(Boolean).join(" ") };
  }
}
