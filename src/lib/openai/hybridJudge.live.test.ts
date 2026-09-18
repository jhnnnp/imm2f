import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import { recommendDatePlanWithOpenAi } from "./recommendDatePlan";
import type { DiscoverCandidate } from "@/features/places/types/place";

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

function place(overrides: Partial<DiscoverCandidate> & Pick<DiscoverCandidate, "externalPlaceId" | "name" | "category" | "categoryLabel">): DiscoverCandidate {
  return {
    externalSource: "kakao",
    address: "서울 성동구 성수동",
    roadAddress: "서울 성동구 서울숲2길 12",
    district: "성수",
    phone: "",
    mapUrl: `https://place.map.kakao.com/${overrides.externalPlaceId}`,
    coordinates: [127.056, 37.544],
    ...overrides,
  };
}

const live = process.env.LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);

describe("hybrid date judge", () => {
  it.skipIf(!live)("judges Kakao rows with web search on an unlocked Seongsu date", async () => {
    const candidates: DiscoverCandidate[] = [
      place({ externalPlaceId: "111", name: "어니언 성수", category: "cafe", categoryLabel: "카페", detailedCategory: "음식점 > 카페 > 커피전문점", kakaoCategoryGroupCode: "CE7", coordinates: [127.055, 37.544] }),
      place({ externalPlaceId: "222", name: "성수연방", category: "restaurant", categoryLabel: "음식점", detailedCategory: "음식점 > 한식", kakaoCategoryGroupCode: "FD6", coordinates: [127.057, 37.545] }),
      place({ externalPlaceId: "333", name: "서울숲", category: "nature", categoryLabel: "공원", detailedCategory: "여행 > 공원", coordinates: [127.037, 37.544] }),
      place({ externalPlaceId: "444", name: "디뮤지엄", category: "photo", categoryLabel: "문화시설", detailedCategory: "문화,예술 > 미술관", kakaoCategoryGroupCode: "CT1", coordinates: [127.039, 37.544] }),
      place({ externalPlaceId: "555", name: "위켄드피크닉", category: "cafe", categoryLabel: "카페", detailedCategory: "음식점 > 카페", kakaoCategoryGroupCode: "CE7", coordinates: [127.056, 37.546] }),
      place({ externalPlaceId: "666", name: "발루트성수", category: "restaurant", categoryLabel: "음식점", detailedCategory: "음식점 > 양식", kakaoCategoryGroupCode: "FD6", coordinates: [127.054, 37.545] }),
    ];
    const state = {
      ...withAreas(emptyDateBrief(), ["성수"]),
      stayKind: "date" as const,
      timeWindow: "afternoon" as const,
      conversationNotes: ["성수에서 데이트하고 싶어"],
    };
    const reply = await recommendDatePlanWithOpenAi({
      prompt: "성수에서 데이트하고 싶어",
      condition: { dateLabel: "2026-09-18", startTime: "14:00", endTime: "20:00", budget: null, region: "성수", timeSpecified: false },
      candidates,
      saved: [],
      state,
    });
    expect(reply.source).toBe("openai");
    expect(reply.recommendations.length).toBeGreaterThanOrEqual(2);
    const stops = reply.card.stops.map(stop => ({
      name: stop.name,
      category: stop.meta,
      rating: stop.rating ?? null,
      dishes: stop.dishes || null,
    }));
    const cafeCount = reply.recommendations.filter(item => item.category.includes("카페")).length;
    expect(cafeCount).toBeLessThan(reply.recommendations.length);
    expect(new Set(stops.map(stop => stop.category.split(" · ")[0])).size).toBeGreaterThan(1);
  }, 90000);
});
