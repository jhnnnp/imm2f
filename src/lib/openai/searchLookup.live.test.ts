import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { completeJsonWithWebSearch } from "./client";
import { getOpenAiModel, getOpenAiSearchModel } from "./env";

if (process.env.LIVE_OPENAI === "1") {
  for (const path of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const match = line.trim().match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
        if (path.endsWith(".local") || !(match[1] in process.env)) process.env[match[1]] = value;
      }
    } catch { /* optional local environment */ }
  }
}

afterEach(() => vi.unstubAllEnvs());
const live = process.env.LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);

it.skipIf(!live)("completes a real bounded public-fact search with tool-provided source provenance", async () => {
  vi.stubEnv("OPENAI_SEARCH_MODEL", "");
  const reasoningModel = getOpenAiModel();
  expect(getOpenAiSearchModel()).toBe("gpt-4.1-mini");
  let sources: string[] = [];
  const result = await completeJsonWithWebSearch<{ reply: string; sourceUrl: string }>({
    instructions: "Search for public information about Seoul Forest park (서울숲공원) in Seoul. Choose one particular page returned by web_search. Return JSON {reply:string,sourceUrl:string}, with a short Korean description of that page and its exact source URL. Do not construct a homepage URL from a domain or change the page path. Do not claim current crowds, booking, opening hours or official status.",
    payload: { question: "서울숲공원 안내 자료 한 개를 찾아줘" },
    requireSearch: true, searchContextSize: "low", timeoutMs: 22000, maxTokens: 500,
    onSources: urls => { sources = urls; },
  });
  expect(result).not.toBeNull();
  expect(getOpenAiModel()).toBe(reasoningModel);
  expect(result?.reply.length).toBeGreaterThan(5);
  const canonical = (value: string) => {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
  };
  expect(sources.map(canonical)).toContain(canonical(result!.sourceUrl));
}, 30000);
