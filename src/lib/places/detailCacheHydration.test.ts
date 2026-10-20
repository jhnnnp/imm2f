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
