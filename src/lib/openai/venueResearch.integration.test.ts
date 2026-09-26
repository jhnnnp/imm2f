import { beforeEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { enrichDateVenues } from "./enrichDateVenues";

const search = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ completeJsonWithWebSearch: search }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
beforeEach(() => { search.mockReset(); });

it("keeps successful evidence when another research request rejects", async () => {
  const candidates: DiscoverCandidate[] = Array.from({ length: 4 }, (_, index) => ({
    externalSource: "kakao", externalPlaceId: `isolation-${index}`, name: `카페${index}`, category: "cafe",
    categoryLabel: "카페", district: "성동구", address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56],
  }));
  search.mockRejectedValueOnce(new Error("provider unavailable"));
  search.mockImplementationOnce(async input => {
    const venue = input.payload.venues[0];
    input.onSources(["https://example.com/cafe"]);
    return { venues: [{ id: venue.id, observations: [{ text: "통창과 테라스가 있는 공간입니다.",
      sourceUrl: "https://example.com/cafe", sourceVenueName: venue.name, sourceAddress: venue.address,
      sourceExcerpt: "통창과 테라스가 있는 공간입니다." }] }] };
  });
  const result = await enrichDateVenues(candidates, emptyDateBrief());
  expect(result).toHaveLength(4);
  expect(result[0].evidence).toBeUndefined();
  expect(result[2].evidence?.[0].branchName).toBe("카페2");
  expect(result[3].evidence).toBeUndefined();
});

it("researches a bounded new cafe pair when the initial batch lacks space evidence", async () => {
  const candidates: DiscoverCandidate[] = Array.from({ length: 18 }, (_, index) => ({
    externalSource: "kakao", externalPlaceId: `retry-${index}`, name: `재조사카페${index}`, category: "cafe",
    categoryLabel: "카페", district: "성동구", address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56],
  }));
  search.mockImplementation(async input => {
    const venue = input.payload.venues[0];
    if (!venue.id.endsWith("retry-8")) return { venues: [] };
    input.onSources(["https://example.com/retry"]);
    return { venues: [{ id: venue.id, observations: [{ text: "정원과 테라스 좌석이 있습니다.",
      sourceUrl: "https://example.com/retry", sourceVenueName: venue.name, sourceAddress: venue.address,
      sourceExcerpt: "정원과 테라스 좌석이 있습니다." }] }] };
  });
  const result = await enrichDateVenues(candidates, { ...emptyDateBrief(), activities: ["cafe"], userRequests: ["예쁜 카페"] });
  expect(search).toHaveBeenCalledTimes(5);
  expect(result[8].evidence).toHaveLength(1);
  expect(search.mock.calls.at(-1)?.[0].timeoutMs).toBeLessThanOrEqual(6000);
});

it("reuses two evidenced options per requested role without another web search", async () => {
  const candidates: DiscoverCandidate[] = ["meal", "meal", "cafe", "cafe"].map((role, index) => ({
    externalSource: "kakao", externalPlaceId: `warm-${index}`, name: `장소${index}`,
    category: role === "meal" ? "restaurant" : "cafe", categoryLabel: role === "meal" ? "식당" : "카페",
    district: "성동구", address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56],
    evidence: [{ id: `fact-${index}`, venueId: `kakao:warm-${index}`, branchName: `장소${index}`,
      text: role === "meal" ? "직접 반죽한 면을 사용합니다." : "통창으로 거리 풍경이 보입니다.",
      url: "https://example.com/source", checkedAt: new Date().toISOString(), attribute: role === "meal" ? "menu" : "space",
      verification: "search_report", sourceExcerpt: "직접 반죽한 면과 통창 풍경을 소개합니다.",
      sourceVenueName: `장소${index}`, sourceAddress: "서울 성동구 왕십리로 281" }],
  }));
  const result = await enrichDateVenues(candidates, { ...emptyDateBrief(), activities: ["meal", "cafe"], userRequests: ["저녁과 예쁜 카페"] });
  expect(result).toHaveLength(4);
  expect(search).not.toHaveBeenCalled();
});

it("moves the longer evidence search to the background corpus profile", async () => {
  const candidates: DiscoverCandidate[] = Array.from({ length: 12 }, (_, index) => ({
    externalSource: "kakao", externalPlaceId: `background-${index}`, name: `배경카페${index}`,
    category: "cafe", categoryLabel: "카페", district: "종로구",
    address: "서울 종로구 수표로28길 33", roadAddress: "서울 종로구 수표로28길 33",
    phone: "", mapUrl: "", coordinates: [126.99, 37.57],
  }));
  search.mockResolvedValue({ venues: [] });
  await enrichDateVenues(candidates, { ...emptyDateBrief(), activities: ["cafe"], userRequests: ["예쁜 카페"] }, undefined, "background");
  expect(search.mock.calls.slice(0, 5).every(([input]) => input.timeoutMs === 20000)).toBe(true);
  expect(search.mock.calls.length).toBeGreaterThanOrEqual(5);
});
