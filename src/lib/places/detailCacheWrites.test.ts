import { beforeEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";

const mocks = vi.hoisted(() => ({ client: vi.fn(), service: vi.fn(), upsert: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, createServiceClient: mocks.service }));
import { writePlaceDetailCache } from "./detailCache";

const venue: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "123", name: "카페",
  category: "cafe", categoryLabel: "카페", district: "성수", address: "서울", roadAddress: "", phone: "", mapUrl: "https://place.map.kakao.com/123", coordinates: [127, 37], rating: 4.2, dishes: "라떼" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ upsert: mocks.upsert });
  mocks.service.mockReturnValue({ from: mocks.from });
  mocks.upsert.mockResolvedValue({ error: null });
});

it("writes verified public facts with the server client and never browser credentials", async () => {
  await writePlaceDetailCache([venue]);
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.from).toHaveBeenCalledWith("place_details_cache");
  expect(mocks.upsert).toHaveBeenCalledWith([expect.objectContaining({ external_source: "kakao", external_place_id: "123", rating: 4.2, food: "라떼" })], { onConflict: "external_source,external_place_id" });
});

it("does not fall back to a browser write when the server key is absent", async () => {
  mocks.service.mockReturnValue(null);
  await writePlaceDetailCache([venue]);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
});

it("keeps cache failures from rejecting an otherwise successful recommendation", async () => {
  mocks.upsert.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(writePlaceDetailCache([venue])).resolves.toBeUndefined();
});
