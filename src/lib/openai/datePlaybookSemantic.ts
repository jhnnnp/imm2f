import { getOpenAiApiKey } from "./env";
import type { DatePlaybookCard } from "./datePlaybook";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 512;
const SEMANTIC_BUDGET_MS = 6000;
const cache = new Map<string, number[]>();
const queryCache = new Map<string, { expiresAt: number; vector: number[] }>();
const pendingQueries = new Map<string, Promise<number[] | undefined>>();
let pendingCards: Promise<void> | null = null;

function untilAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const abort = () => resolve(null);
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve(operation).then(resolve, () => resolve(null))
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function embedPlaybookTexts(input: string[], timeoutMs = 5000): Promise<number[][] | null> {
  const key = getOpenAiApiKey();
  if (!key || !input.length || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  const request = (async () => {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, dimensions: DIMENSIONS, input }),
        signal,
      });
      if (!response.ok) return null;
      const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
      signal.throwIfAborted();
      if (!Array.isArray(body.data) || body.data.length !== input.length
        || new Set(body.data.map(row => row.index)).size !== input.length
        || body.data.some(row => !Number.isInteger(row.index) || row.index < 0 || row.index >= input.length)) return null;
      const vectors = body.data.sort((a, b) => a.index - b.index).map(row => row.embedding);
      return vectors.length === input.length && vectors.every(vector => Array.isArray(vector)
        && vector.length === DIMENSIONS && vector.every(Number.isFinite)) ? vectors : null;
    } catch { return null; }
  })();
  // The deadline covers a response body that ignores abort, too.
  return untilAbort(request, signal);
}

function cosine(left: number[], right: number[]) {
  let dot = 0; let leftLength = 0; let rightLength = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i]; leftLength += left[i] ** 2; rightLength += right[i] ** 2;
  }
  return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength) || 1);
}

/** Cached in-process semantic ranking; metadata gates remain in datePlaybook. */
export async function playbookSemanticScores(query: string, cards: DatePlaybookCard[], stage: string, signal?: AbortSignal): Promise<Map<string, number>> {
  if (!getOpenAiApiKey() || !cards.length || signal?.aborted) return new Map();
  const deadline = new AbortController();
  const abort = () => deadline.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => deadline.abort(), SEMANTIC_BUDGET_MS);
  const request = (async (): Promise<Map<string, number>> => {
    let queryVector = queryCache.get(query)?.expiresAt && queryCache.get(query)!.expiresAt > Date.now()
      ? queryCache.get(query)!.vector : undefined;
    if (!queryVector) {
      let pending = pendingQueries.get(query);
      if (!pending) {
        // Shared embeddings have their own timeout. One canceled planner must not cancel another.
        pending = embedPlaybookTexts([query]).then(vectors => {
          const vector = vectors?.[0];
          if (vector) {
            if (queryCache.size >= 100) queryCache.delete(queryCache.keys().next().value!);
            queryCache.set(query, { vector, expiresAt: Date.now() + 5 * 60_000 });
          }
          return vector;
        }).finally(() => pendingQueries.delete(query));
        pendingQueries.set(query, pending);
      }
      queryVector = await untilAbort(pending, deadline.signal) ?? undefined;
      if (!queryVector || deadline.signal.aborted) return new Map();
    }
    if (deadline.signal.aborted) return new Map();
    const client = createServiceClient();
    if (client) {
      const result = await untilAbort(client.rpc("match_date_playbook", {
        query_embedding: JSON.stringify(queryVector), target_stage: stage, match_count: 100,
      }).abortSignal(deadline.signal), deadline.signal);
      if (deadline.signal.aborted) return new Map();
      const expected = cards.filter(card => card.active && card.stage === stage).length;
      if (result && !result.error && result.data && result.data.length >= expected) {
        return new Map(result.data.map(row => [row.id, row.similarity]));
      }
    }
    if (deadline.signal.aborted) return new Map();
    const missing = cards.filter(card => !cache.has(`${card.id}:${card.version}`));
    if (missing.length && !pendingCards) pendingCards = (async () => {
      const vectors = await embedPlaybookTexts(missing.map(card => `${card.title}. ${card.guidance} ${card.example}`));
      if (vectors) missing.forEach((card, index) => cache.set(`${card.id}:${card.version}`, vectors[index]));
    })().finally(() => { pendingCards = null; });
    if (pendingCards) await untilAbort(pendingCards, deadline.signal);
    if (deadline.signal.aborted) return new Map();
    return new Map(cards.flatMap(card => {
      const vector = cache.get(`${card.id}:${card.version}`);
      return vector ? [[card.id, cosine(queryVector, vector)] as const] : [];
    }));
  })();
  try {
    return await untilAbort(request, deadline.signal) ?? new Map();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
