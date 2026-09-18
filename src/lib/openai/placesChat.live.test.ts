import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import { filterPlaceCandidates, placeSearchPlans, rankPlaceCandidates } from "@/features/ai/placeRecommend";
import type { PlaceAsk } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";
import { answerDateQuestion } from "./answerDateQuestion";
import { composeDateChat } from "./composeDateChat";
import { recommendPlacesWithOpenAi } from "./recommendPlaces";
import { routeDateChat } from "./routeDateChat";

function loadLocalEnv() {
  for (const path of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (path.endsWith(".local") || !(key in process.env)) process.env[key] = value;
      }
    } catch {
      // optional env file
    }
  }
}

loadLocalEnv();

const live = process.env.LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.KAKAO_REST_API_KEY);
const noAllow = { hoe: false, meat: false, bar: false };

describe("place recommendation chat (live)", () => {
  it.skipIf(!live)("recommends Seongsu pasta restaurants with looked-up facts", async () => {
    const ask: PlaceAsk = { kind: "restaurant", query: "파스타", area: "성수" };
    const searches = await Promise.all(placeSearchPlans(ask).map(plan => searchKakaoPlacesRemote({
      region: plan.region,
      query: plan.query,
      category: plan.category,
      page: plan.page,
    })));
    const pool: DiscoverCandidate[] = searches.flatMap(result => (result.ok ? result.places : []));
    expect(pool.length).toBeGreaterThan(3);
    const ranked = rankPlaceCandidates(
      filterPlaceCandidates(pool, ask, { allowHarsh: noAllow, exclude: [], violatesAvoid: () => false }),
      ask,
      { savedPositive: new Set(), recentlyVisited: new Set(), commonTastes: [], activities: [] },
    );
    const result = await recommendPlacesWithOpenAi({
      message: "성수 파스타 맛집 추천해줘",
      ask,
      candidates: ranked,
      savedNames: new Set(),
      bothWant: new Set(),
      coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] },
      alreadyShown: [],
    });
    expect(result.source).toBe("openai");
    expect(result.card.stops?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(result.card.lines[0].length).toBeGreaterThan(10);
    for (const stop of result.card.stops ?? []) {
      expect(ranked.some(candidate => candidate.name === stop.name)).toBe(true);
      expect(stop.reason?.length ?? 0).toBeGreaterThan(5);
    }
  }, 120000);

  it.skipIf(!live)("answers a practical question and small talk in natural Korean", async () => {
    const state = { ...withAreas(emptyDateBrief(), ["성수"]), stayKind: "date" as const };
    const answer = await answerDateQuestion({
      message: "첫 번째 식당 예약 필요해?",
      state,
      stops: [{ name: "성수연방", meta: "한식 · 성동구 성수동", address: "서울 성동구 성수이로14길 14", mapUrl: "https://place.map.kakao.com/1234" }],
      coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] },
    });
    expect(answer.lines[0].length).toBeGreaterThan(10);
    const chat = await composeDateChat({ situation: "greeting", userMessage: "안녕", state });
    expect(chat.lines[0].length).toBeGreaterThan(5);
    const route = await routeDateChat({ message: "거기 사람 많을까", state, hasCourse: true, currentCourse: ["성수연방"] });
    expect(route.mode).toBe("question");
  }, 90000);
});
