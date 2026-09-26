import type { PlanChange } from "@/features/planning/types/plan";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

export type PlanEditItemInput = {
  id: string;
  placeName: string;
  category: string;
  startTime: string;
  durationMinutes: number;
  expectedCost: number;
};

type EditPayload = {
  changes?: Array<{
    type?: string;
    itemId?: string;
    minutes?: number;
  }>;
};

function clampMinutes(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(30, Math.min(240, Math.round(n / 10) * 10));
}

export async function proposePlanEditsWithOpenAi(input: {
  kind: "date" | "trip";
  prompt: string;
  items: PlanEditItemInput[];
}): Promise<{ changes: PlanChange[]; summary: string } | { error: string }> {
  if (!isOpenAiConfigured()) {
    return { error: "OpenAI API 키가 아직 없어요. 서버 환경 변수에 OPENAI_API_KEY를 넣어 주세요." };
  }
  if (!input.items.length) {
    return { error: "수정할 일정이 없어요. 장소를 먼저 담아 주세요." };
  }
  const prompt = input.prompt.trim();
  if (!prompt) return { error: "어떤 방향으로 바꾸고 싶은지 적어 주세요." };
  if (prompt.length > 500) return { error: "요청은 500자 이내로 적어 주세요." };

  const allowed = new Map(input.items.map(item => [item.id, item]));
  const catalog = input.items.map(item => ({
    id: item.id,
    name: item.placeName,
    category: item.category,
    startTime: item.startTime,
    durationMinutes: item.durationMinutes,
    expectedCost: item.expectedCost,
  }));

  try {
    const parsed = await completeJson<EditPayload>({
      temperature: 0.2,
      maxTokens: 2000,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: [
            "You edit an existing couple plan. Never invent places, addresses, coordinates, prices, distances, travel times, or new item ids.",
            "Only propose changes for provided item ids.",
            "Allowed change types: remove, duration.",
            "For duration, minutes must be 30-240 in steps of 10.",
            "JSON shape: {\"changes\":[{\"type\":\"remove\",\"itemId\":\"...\"},{\"type\":\"duration\",\"itemId\":\"...\",\"minutes\":90}]}",
            "Return 1-4 useful changes. If the request cannot be fulfilled with existing items, return {\"changes\":[]}.",
          ].join(" "),
        },
        {
          role: "user",
          content: `계획 종류: ${input.kind}\n요청: ${prompt}\n현재 일정:\n${JSON.stringify(catalog)}`,
        },
      ],
    });
    if (!parsed) {
      return { error: "AI 제안을 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
    const changes: PlanChange[] = [];
    const seen = new Set<string>();
    const explicitlyClearAll = /전부|모두|전체|싹|다\s*빼|다\s*지워/.test(prompt)
      || (input.items.length === 1 && /빼|삭제|제외/.test(prompt));
    let removals = 0;

    for (const row of Array.isArray(parsed.changes) ? parsed.changes : []) {
      if (!row || typeof row !== "object") continue;
      if (changes.length >= 4) break;
      const itemId = String(row.itemId ?? "");
      const item = allowed.get(itemId);
      if (!item || seen.has(itemId)) continue;
      if (row.type === "remove") {
        if (!explicitlyClearAll && removals + 1 >= input.items.length) continue;
        seen.add(itemId);
        removals++;
        changes.push({
          type: "remove",
          itemId,
          label: item.placeName,
          detail: "일정에서 이 장소를 제외합니다.",
        });
        continue;
      }
      if (row.type === "duration") {
        const minutes = clampMinutes(row.minutes, item.durationMinutes);
        if (minutes === item.durationMinutes) continue;
        seen.add(itemId);
        changes.push({
          type: "duration",
          itemId,
          minutes,
          label: item.placeName,
          detail: `머무는 시간 ${item.durationMinutes}분 → ${minutes}분`,
        });
      }
    }

    return {
      changes,
      summary: changes.length
        ? `${changes.length}가지 변경을 제안했어요. 적용할 항목을 골라 주세요.`
        : "기존 일정만으로는 바꿀 항목을 찾지 못했어요.",
    };
  } catch {
    return { error: "AI 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
}
