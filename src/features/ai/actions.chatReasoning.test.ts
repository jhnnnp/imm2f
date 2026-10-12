import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyDateBrief, withAreas } from "./dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";

vi.mock("@/features/auth/session", () => ({ getAppSession: vi.fn(async () => ({
  mode: "authenticated", userId: "user", coupleId: "couple", displayName: "나", partner: null,
})) }));
vi.mock("@/features/taste/actions", () => ({ loadTasteBoard: vi.fn(async () => ({
  you: null, partner: null, youName: "나", partnerName: "파트너", partnerConnected: false, compare: null,
})) }));
vi.mock("@/features/places/actions", () => ({ listPlaces: vi.fn(async () => ({ places: [] })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => null) }));
vi.mock("@/lib/openai/routeDateChat", () => ({ routeDateChat: vi.fn() }));
vi.mock("@/lib/openai/composeDateChat", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/openai/composeDateChat")>(), composeDateChat: vi.fn(),
}));
vi.mock("@/lib/openai/interpretDateRequest", () => ({ interpretDateRequest: vi.fn() }));
vi.mock("@/lib/openai/recommendPlaces", () => ({ recommendPlacesWithOpenAi: vi.fn() }));
vi.mock("@/lib/kakao/local", () => ({ searchKakaoPlacesRemote: vi.fn() }));
vi.mock("@/lib/tourapi/env", () => ({ isTourApiConfigured: vi.fn(() => false) }));
vi.mock("@/lib/places/detailCache", () => ({ hydrateDateCandidates: vi.fn(async rows => rows) }));

import { recommendDatePlan } from "./actions";
import { routeDateChat } from "@/lib/openai/routeDateChat";
import { composeDateChat } from "@/lib/openai/composeDateChat";
import { interpretDateRequest } from "@/lib/openai/interpretDateRequest";
import { recommendPlacesWithOpenAi } from "@/lib/openai/recommendPlaces";
import { searchKakaoPlacesRemote } from "@/lib/kakao/local";

const state = { ...withAreas(emptyDateBrief(), ["성수"]), stayKind: "date" as const,
  timeWindow: "any" as const, shownPlaces: ["지난 식당"], seenPlaces: ["지난 식당"] };
const venue = (id: string, name: string): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name, category: "restaurant", categoryLabel: "음식점",
  detailedCategory: "음식점 > 양식 > 이탈리안", address: "서울 성동구 성수동", roadAddress: "",
  district: "성수", phone: "", mapUrl: `https://place.map.kakao.com/${id}`,
  coordinates: [127.055, 37.544], kakaoCategoryGroupCode: "FD6",
});

beforeEach(() => {
  vi.stubEnv("DATE_TURN_INTERPRETER_MODE", "off");
  vi.stubEnv("DATE_RESEARCH_PLAN_MODE", "off");
  vi.stubEnv("DATE_EXECUTION_MODE", "off");
  vi.mocked(composeDateChat).mockResolvedValue({ headline: "", lines: ["문맥을 보고 답했어요."] });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it("routes a complaint through semantic understanding instead of the immediate feedback shortcut", async () => {
  vi.mocked(routeDateChat).mockResolvedValue({ mode: "chat", confident: true });
  const conversation = [{ role: "assistant" as const, text: "조용한 카페를 원하신다고 하셨죠." }];
  const result = await recommendDatePlan({ message: "추천이 별로야", previousState: state, conversation });
  expect(routeDateChat).toHaveBeenCalledWith(expect.objectContaining({ message: "추천이 별로야", conversation }));
  expect(composeDateChat).toHaveBeenCalledWith(expect.objectContaining({ extras: expect.objectContaining({ conversation }) }));
  expect(result).toMatchObject({ status: "chat", message: "문맥을 보고 답했어요." });
});

it("interprets new food restrictions before standalone place filtering and preserves place history", async () => {
  vi.mocked(routeDateChat).mockResolvedValue({ mode: "places", confident: true,
    placeAsk: { kind: "restaurant", query: "파스타", area: "성수" } });
  vi.mocked(interpretDateRequest).mockResolvedValue({ state: { ...state, excludedFoods: ["새우"],
    foodAllergy: true, preferences: { vibe: ["대화하기 좋은"] } }, slot: null, reply: "" });
  const candidates = [venue("1", "새우 파스타 식당"), venue("2", "토마토 파스타 식당")];
  vi.mocked(searchKakaoPlacesRemote).mockResolvedValue({ ok: true, places: candidates,
    page: 1, totalCount: 2, isEnd: true });
  vi.mocked(recommendPlacesWithOpenAi).mockImplementation(async input => ({
    card: { headline: "", lines: ["조건에 맞는 식당이에요."], stops: input.candidates.map(place => ({
      name: place.name, meta: place.categoryLabel, address: place.address,
    })) }, shownPlaces: input.candidates.map(place => place.name), source: "openai", candidates: input.candidates,
  }));
  const result = await recommendDatePlan({ message: "새우 알레르기가 있어. 성수에서 대화하기 좋은 파스타 식당 더 추천해줘",
    previousState: { ...state, placeAsk: { kind: "restaurant", query: "파스타", area: "성수" } } });
  expect(interpretDateRequest).toHaveBeenCalledTimes(1);
  const input = vi.mocked(recommendPlacesWithOpenAi).mock.calls[0][0];
  expect(input.candidates.map(place => place.name)).toEqual(["토마토 파스타 식당"]);
  expect(result).toMatchObject({ status: "chat", state: { excludedFoods: ["새우"], foodAllergy: true,
    preferences: { vibe: ["대화하기 좋은"] }, seenPlaces: ["토마토 파스타 식당", "지난 식당"] } });
});
