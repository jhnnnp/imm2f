import type { DiscoverCandidate } from "@/features/places/types/place";

export type RankedCandidate = {
  externalSource: "kakao" | "tourapi";
  externalPlaceId: string;
  userFit: number;
  partnerFit: number;
  reason: string;
};

function candidateKey(item: { externalSource?: string; externalPlaceId: string }) {
  return `${item.externalSource === "tourapi" ? "tourapi" : "kakao"}:${item.externalPlaceId}`;
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
