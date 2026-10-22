import { beforeEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";

const mocks = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null, createServiceClient: () => null }));
vi.mock("@/lib/tourapi/client", () => ({ loadTourPlaceDetail: mocks.detail }));
import { hydrateDateCandidates } from "./detailCache";

function venue(id: string): DiscoverCandidate {
  return { externalSource: "tourapi", externalPlaceId: id, name: `관광지 ${id}`,
    category: "tourist", categoryLabel: "관광지", address: "전북특별자치도 군산시", district: "군산",
    roadAddress: "", phone: "", mapUrl: "https://map.kakao.com/", coordinates: [126.7, 35.97] };
}

beforeEach(() => vi.clearAllMocks());

it("starts the bounded shortlist together and preserves exact-venue facts", async () => {
  const candidates = Array.from({ length: 20 }, (_, index) => venue(String(index)));
  let resolveDetails!: (value: { overview: string; openingHours: string; facts: [] }) => void;
  const pending = new Promise<{ overview: string; openingHours: string; facts: [] }>(resolve => { resolveDetails = resolve; });
  mocks.detail.mockReturnValue(pending);
  const hydrated = hydrateDateCandidates(candidates, []);
  await vi.waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(8));
  resolveDetails({ overview: "공식 관광 소개", openingHours: "09:00~18:00", facts: [] });
  const result = await hydrated;
  expect(result).toHaveLength(20);
  expect(mocks.detail).toHaveBeenCalledTimes(8);
  expect(mocks.detail.mock.calls[0][3]).toMatchObject({ includeImages: false, signal: expect.any(AbortSignal) });
  expect(result[0]).toMatchObject({ openingHours: "09:00~18:00", evidence: [expect.objectContaining({
    venueId: "tourapi:0", sourceVenueName: "관광지 0", text: "공식 관광 소개", verification: "source_checked",
  })] });
  expect(candidates[0].openingHours).toBeUndefined();
});

it("keeps the venue and existing evidence when optional detail retrieval fails", async () => {
  const candidate = { ...venue("1"), evidence: [{ id: "existing", text: "기존 근거", url: "https://example.com", checkedAt: "2026-10-20" }] };
  mocks.detail.mockRejectedValue(new Error("source unavailable"));
  const result = await hydrateDateCandidates([candidate], []);
  expect(result[0]).toEqual(candidate);
});

it("reserves up to four official food targets within the same eight-request wave", async () => {
  const meals = Array.from({ length: 6 }, (_, index) => ({ ...venue(`meal-${index}`),
    category: "restaurant" as const, categoryLabel: "음식점", tourContentTypeId: "39",
    image: "https://example.com/food.jpg", openingHours: "기존 영업시간" }));
  const attractions = Array.from({ length: 10 }, (_, index) => venue(`attraction-${index}`));
  mocks.detail.mockResolvedValue({ overview: "", dishes: "대표 비빔밥", openingHours: "새 영업시간",
    facts: [{ label: "대표 메뉴", value: "대표 비빔밥" }] });
  const result = await hydrateDateCandidates([...attractions, ...meals], []);
  expect(mocks.detail).toHaveBeenCalledTimes(8);
  expect(mocks.detail.mock.calls.filter(([, category]) => category === "restaurant")).toHaveLength(4);
  const meal = result.find(candidate => candidate.externalPlaceId === "meal-0")!;
  expect(meal).toMatchObject({ openingHours: "기존 영업시간", dishes: "대표 비빔밥",
    evidence: [expect.objectContaining({ venueId: "tourapi:meal-0", attribute: "menu",
      sourceVenueName: "관광지 meal-0", sourceAddress: "전북특별자치도 군산시",
      verification: "source_checked", url: "https://www.data.go.kr/data/15101578/openapi.do" })] });
  expect(meals[0].dishes).toBeUndefined();
});

it("preserves existing food facts while attaching a separate official menu observation", async () => {
  const meal = { ...venue("meal"), category: "restaurant" as const, categoryLabel: "음식점", tourContentTypeId: "39",
    dishes: "이미 확인한 메뉴", openingHours: "이미 확인한 시간", factSourceUrl: "https://example.com/verified-menu",
    evidence: [{ id: "prior", text: "기존 공간 근거", url: "https://example.com/space", checkedAt: new Date().toISOString() }] };
  mocks.detail.mockResolvedValue({ overview: "", dishes: "공식 대표 메뉴", openingHours: "11:00~20:00",
    facts: [{ label: "대표 메뉴", value: "공식 대표 메뉴" }] });
  const [result] = await hydrateDateCandidates([meal], []);
  expect(result).toMatchObject({ dishes: "이미 확인한 메뉴", openingHours: "이미 확인한 시간",
    factSourceUrl: "https://example.com/verified-menu" });
  expect(result.evidence).toHaveLength(2);
  expect(result.evidence?.[1]).toMatchObject({ attribute: "menu", text: "대표 메뉴: 공식 대표 메뉴", venueId: "tourapi:meal" });
});
