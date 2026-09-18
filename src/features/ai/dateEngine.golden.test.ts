import { describe, expect, it } from "vitest";
import { applyDateDefaults, discoveryActivities, extractStay, searchIntents, withAreas } from "@/features/ai/dateBrief";
import { applyInterpretPatch, fallbackPatch } from "@/lib/openai/interpretDateRequest";

type GoldenCase = {
  message: string;
  areas: string[];
  stayKind: "date" | "daytrip" | "overnight" | null;
  activities: string[];
  search?: {
    has?: string[];
    missing?: string[];
  };
};

const GOLDEN: GoldenCase[] = [
  { message: "성수에서 데이트하고 싶어", areas: ["성수"], stayKind: "date", activities: [], search: { has: ["cafe", "restaurant", "photo", "nature"] } },
  { message: "성수 갈래", areas: ["성수"], stayKind: "date", activities: [] },
  { message: "성수에서 전시 보고 싶어", areas: ["성수"], stayKind: "date", activities: ["exhibit"] },
  { message: "성수 카페 투어 하고 싶어", areas: ["성수"], stayKind: "date", activities: ["cafe"] },
  { message: "성수에서 저녁 데이트", areas: ["성수"], stayKind: "date", activities: [], search: { has: ["restaurant", "cafe"] } },
  { message: "을지로에서 데이트하고 싶어", areas: ["을지로"], stayKind: "date", activities: [], search: { has: ["restaurant", "photo"], missing: ["파스타"] } },
  { message: "을지로에서 저녁부터", areas: ["을지로"], stayKind: "date", activities: [], search: { has: ["restaurant", "cafe"] } },
  { message: "강남에서 데이트하고 싶어", areas: ["강남"], stayKind: "date", activities: [] },
  { message: "한강에서 데이트하고 싶어", areas: ["한강"], stayKind: "date", activities: [] },
  { message: "포천 여행 짜줘", areas: ["포천"], stayKind: null, activities: [], search: { has: ["관광지"] } },
  { message: "포천 1박2일", areas: ["포천"], stayKind: "overnight", activities: [], search: { has: ["관광지"] } },
  { message: "비 오는 날 성수 실내 데이트", areas: ["성수"], stayKind: "date", activities: [], search: { has: ["방탈출", "restaurant"] } },
  { message: "제주에서 하루 보내고 싶어", areas: ["제주"], stayKind: null, activities: [], search: { has: ["관광지"] } },
  { message: "파스타 먹고 성수 걷고 싶어", areas: ["성수"], stayKind: "date", activities: ["meal", "walk"] },
  { message: "홍대에서 데이트하고 싶어", areas: ["홍대"], stayKind: "date", activities: [] },
  { message: "한남에서 데이트하고 싶어", areas: ["한남"], stayKind: "date", activities: [] },
  { message: "잠실에서 데이트하고 싶어", areas: ["잠실"], stayKind: "date", activities: [] },
  { message: "가평 여행", areas: ["가평"], stayKind: null, activities: [], search: { has: ["관광지"] } },
  { message: "성수에서 밥 먹고 싶어", areas: ["성수"], stayKind: "date", activities: ["meal"] },
  { message: "강남 저녁부터 데이트", areas: ["강남"], stayKind: "date", activities: [], search: { has: ["restaurant", "cafe"] } },
];

describe("date engine golden set", () => {
  it.each(GOLDEN)("$message", ({ message, areas, stayKind, activities, search }) => {
    expect(extractStay(message)?.stayKind ?? null).toBe(stayKind);
    const result = applyInterpretPatch({ message, patch: fallbackPatch(message) });
    for (const area of areas) expect(result.state.areas).toContain(area);
    expect(result.state.stayKind).toBe(stayKind);
    const state = applyDateDefaults(result.state.areas.length ? result.state : withAreas(result.state, areas));
    expect(state.activities).toEqual(activities);
    const intents = searchIntents(state);
    if (!activities.length) expect(discoveryActivities(state).length).toBeGreaterThan(0);
    else {
      expect(discoveryActivities(state)).toEqual(expect.arrayContaining(activities));
      if (/투어|위주/.test(message)) expect(discoveryActivities(state)).toEqual(activities);
      else expect(discoveryActivities(state).length).toBeGreaterThan(activities.length);
    }
    for (const needle of search?.has ?? []) {
      expect(intents.some(intent => intent.category === needle || intent.query === needle)).toBe(true);
    }
    for (const needle of search?.missing ?? []) {
      expect(intents.some(intent => intent.category === needle || intent.query === needle)).toBe(false);
    }
  });
});
