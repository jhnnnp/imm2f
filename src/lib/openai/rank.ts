import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";

export type RankedCandidate = {
  externalSource: "kakao" | "tourapi";
  externalPlaceId: string;
  userFit: number;
  partnerFit: number;
  reason: string;
};

type RankPayload = {
  rankings?: Array<{
    id?: string;
    userFit?: number;
    partnerFit?: number;
    reason?: string;
  }>;
};

function candidateKey(item: { externalSource?: string; externalPlaceId: string }) {
  return `${item.externalSource === "tourapi" ? "tourapi" : "kakao"}:${item.externalPlaceId}`;
}

function clampFit(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function tasteLines(saved: Place[]) {
  return saved.slice(0, 24).map(place => {
    const status = `${place.userStatus}/${place.partnerStatus}`;
    return `- ${place.name} (${place.categoryLabel}, ${place.district}, ${status})`;
  }).join("\n");
}

export async function rankDiscoverCandidates(candidates: DiscoverCandidate[], saved: Place[]): Promise<RankedCandidate[] | null> {
  if (!isOpenAiConfigured() || candidates.length < 2) return null;
  const catalog = candidates.map(item => ({
    id: candidateKey(item),
    name: item.name,
    category: item.categoryLabel,
    district: item.district,
    address: item.roadAddress || item.address,
    source: item.externalSource,
  }));
  const allowed = new Set(catalog.map(item => item.id));

  try {
    const parsed = await completeJson<RankPayload>({
      temperature: 0.2,
      maxTokens: 2500,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: "You rank existing place candidates for a couple. Never invent places or ids. Only use the provided candidate ids. Reply JSON: {\"rankings\":[{\"id\":\"kakao:123\",\"userFit\":0-100,\"partnerFit\":0-100,\"reason\":\"Korean one sentence\"}]}. Include every provided id exactly once.",
        },
        {
          role: "user",
          content: `저장된 취향:\n${tasteLines(saved) || "- 아직 저장된 장소가 없어요."}\n\n후보:\n${JSON.stringify(catalog)}`,
        },
      ],
    });
    if (!parsed) return null;
    const ranked: RankedCandidate[] = [];
    const seen = new Set<string>();
    for (const row of parsed.rankings ?? []) {
      const id = String(row.id ?? "");
      if (!allowed.has(id) || seen.has(id)) continue;
      const [source, ...rest] = id.split(":");
      const externalPlaceId = rest.join(":");
      if (!externalPlaceId) continue;
      seen.add(id);
      ranked.push({
        externalSource: source === "tourapi" ? "tourapi" : "kakao",
        externalPlaceId,
        userFit: clampFit(row.userFit),
        partnerFit: clampFit(row.partnerFit),
        reason: String(row.reason ?? "").trim().slice(0, 80),
      });
    }
    for (const item of candidates) {
      const id = candidateKey(item);
      if (seen.has(id)) continue;
      ranked.push({
        externalSource: item.externalSource,
        externalPlaceId: item.externalPlaceId,
        userFit: 0,
        partnerFit: 0,
        reason: "",
      });
    }
    return ranked.length ? ranked : null;
  } catch {
    return null;
  }
}

export function applyRanking(candidates: DiscoverCandidate[], ranking: RankedCandidate[] | null) {
  if (!ranking?.length) return candidates;
  const byKey = new Map(candidates.map(item => [candidateKey(item), item]));
  const ordered: DiscoverCandidate[] = [];
  for (const row of ranking) {
    const item = byKey.get(candidateKey(row));
    if (item) ordered.push(item);
  }
  for (const item of candidates) {
    if (!ordered.includes(item)) ordered.push(item);
  }
  return ordered;
}

export { candidateKey };
