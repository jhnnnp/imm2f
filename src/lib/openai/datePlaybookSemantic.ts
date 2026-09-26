import { getOpenAiApiKey } from "./env";
import type { DatePlaybookCard } from "./datePlaybook";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;
const cache = new Map<string, number[]>();
const queryCache = new Map<string, { expiresAt: number; vector: number[] }>();
let pendingCards: Promise<void> | null = null;

export async function embedPlaybookTexts(input: string[], timeoutMs = 5000): Promise<number[][] | null> {
  const key = getOpenAiApiKey();
  if (!key || !input.length) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, dimensions: DIMENSIONS, input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const vectors = (body.data ?? []).sort((a, b) => a.index - b.index).map(row => row.embedding);
    return vectors.length === input.length && vectors.every(vector => vector.length === DIMENSIONS && vector.every(Number.isFinite))
      ? vectors : null;
  } catch { return null; }
}

function cosine(left: number[], right: number[]) {
  let dot = 0; let leftLength = 0; let rightLength = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i]; leftLength += left[i] ** 2; rightLength += right[i] ** 2;
  }
  return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength) || 1);
}

/** Cached in-process semantic ranking; metadata gates remain in datePlaybook. */
export async function playbookSemanticScores(query: string, cards: DatePlaybookCard[], stage: string): Promise<Map<string, number>> {
  if (!getOpenAiApiKey() || !cards.length) return new Map();
  let queryVector = queryCache.get(query)?.expiresAt && queryCache.get(query)!.expiresAt > Date.now()
    ? queryCache.get(query)!.vector : undefined;
  if (!queryVector) {
    queryVector = (await embedPlaybookTexts([query]))?.[0];
    if (!queryVector) return new Map();
    if (queryCache.size > 100) queryCache.clear();
    queryCache.set(query, { vector: queryVector, expiresAt: Date.now() + 5 * 60_000 });
  }
  const client = createServiceClient();
  if (client) {
    const { data, error } = await client.rpc("match_date_playbook", {
      query_embedding: JSON.stringify(queryVector), target_stage: stage, match_count: 100,
    });
    const expected = cards.filter(card => card.active && card.stage === stage).length;
    if (!error && data && data.length >= expected) {
      return new Map(data.map(row => [row.id, row.similarity]));
    }
  }
  const missing = cards.filter(card => !cache.has(`${card.id}:${card.version}`));
  if (missing.length && !pendingCards) pendingCards = (async () => {
    const vectors = await embedPlaybookTexts(missing.map(card => `${card.title}. ${card.guidance} ${card.example}`));
    if (vectors) missing.forEach((card, index) => cache.set(`${card.id}:${card.version}`, vectors[index]));
  })().finally(() => { pendingCards = null; });
  if (pendingCards) await pendingCards;
  return new Map(cards.flatMap(card => {
    const vector = cache.get(`${card.id}:${card.version}`);
    return vector ? [[card.id, cosine(queryVector, vector)] as const] : [];
  }));
}
