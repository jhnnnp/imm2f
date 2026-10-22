import { beforeEach, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { enrichDateVenues } from "./enrichDateVenues";
import { readVenueEvidence, writeVenueEvidence } from "./venueEvidenceStore";

const search = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ completeJsonWithWebSearch: search }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
vi.mock("./venueEvidenceStore", () => ({ readVenueEvidence: vi.fn(), writeVenueEvidence: vi.fn() }));
beforeEach(() => {
  search.mockReset();
  vi.mocked(readVenueEvidence).mockReset().mockResolvedValue(new Map());
  vi.mocked(writeVenueEvidence).mockReset().mockResolvedValue(undefined);
});

it("keeps successful evidence when another research request rejects", async () => {
  const candidates: DiscoverCandidate[] = Array.from({ length: 4 }, (_, index) => ({
    externalSource: "kakao", externalPlaceId: `isolation-${index}`, name: `카페${index}`, category: "cafe",
    categoryLabel: "카페", district: "성동구", address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56],
  }));
  search.mockResolvedValue({ venues: [] }).mockRejectedValueOnce(new Error("provider unavailable"));
  search.mockImplementationOnce(async input => {
    const venue = input.payload.venues[0];
    input.onSources(["https://example.com/cafe"]);
    return { venues: [{ id: venue.id, observations: [{ text: "통창과 테라스가 있는 공간입니다.",
      sourceUrl: "https://example.com/cafe", sourceVenueName: venue.name, sourceAddress: venue.address,
      sourceExcerpt: "통창과 테라스가 있는 공간입니다." }] }] };
  });
  const result = await enrichDateVenues(candidates, emptyDateBrief());
  expect(result).toHaveLength(4);
  expect(result[0].evidence).toEqual([]);
  expect(result[1].evidence?.[0].branchName).toBe("카페1");
  expect(result[2].evidence).toEqual([]);
  expect(result[3].evidence).toEqual([]);
  expect(search).toHaveBeenCalledTimes(4);
  expect(search.mock.calls.every(([input]) => input.payload.venues.length === 1)).toBe(true);
});

it("keeps unknown cafe space facts unknown after one bounded interactive wave", async () => {
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
  expect(search).toHaveBeenCalledTimes(4);
  expect(result.every(candidate => !candidate.evidence?.length)).toBe(true);
  expect(search.mock.calls.every(([input]) => input.timeoutMs > 0 && input.timeoutMs <= 7000)).toBe(true);
  expect(search.mock.calls.flatMap(([input]) => input.payload.venues.map((venue: { id: string }) => venue.id)))
    .toEqual(["kakao:retry-0", "kakao:retry-1", "kakao:retry-2", "kakao:retry-3"]);
});

it("honors the shared deadline and retains early successful evidence when another research call stalls", async () => {
  const candidates: DiscoverCandidate[] = Array.from({ length: 4 }, (_, index) => ({
    externalSource: "kakao", externalPlaceId: `stalled-${index}`, name: `시간제한카페${index}`, category: "cafe",
    categoryLabel: "카페", district: "성동구", address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56],
  }));
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    search.mockResolvedValue({ venues: [] }).mockImplementationOnce(async input => {
      const venue = input.payload.venues[0];
      input.onSources(["https://example.com/early"]);
      return { venues: [{ id: venue.id, observations: [{ text: "정원과 테라스 좌석이 있습니다.",
        sourceUrl: "https://example.com/early", sourceVenueName: venue.name, sourceAddress: venue.address,
        sourceExcerpt: "정원과 테라스 좌석이 있습니다." }] }] };
    }).mockImplementationOnce(() => new Promise(() => {}));
    const pending = enrichDateVenues(candidates, { ...emptyDateBrief(), activities: ["cafe"] });
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(4));
    expect(timeout).toHaveBeenCalledWith(7000);
    controller.abort();
    const result = await pending;
    expect(result[0].evidence?.[0].text).toContain("정원과 테라스");
    expect(result[2].evidence?.length ?? 0).toBe(0);
    expect(search).toHaveBeenCalledTimes(4);
  } finally { timeout.mockRestore(); }
});

it("returns immediately for a canceled caller without reading the evidence store", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await enrichDateVenues([], emptyDateBrief(), undefined, "interactive", controller.signal)).toEqual([]);
  expect(readVenueEvidence).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
});

it("asks for actual noise evidence when quiet conversation is a stored preference", async () => {
  const venue: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "quiet-focus", name: "대화식당",
    category: "restaurant", categoryLabel: "식당", district: "성동구", address: "서울 성동구 왕십리로 281",
    roadAddress: "서울 성동구 왕십리로 281", phone: "", mapUrl: "", coordinates: [127.04, 37.56] };
  search.mockImplementation(async input => {
    input.onSources(["https://example.com/quiet"]);
    return { venues: [{ id: "kakao:quiet-focus", observations: [{ text: "실내 좌석의 소음이 적다고 안내합니다.",
      sourceUrl: "https://example.com/quiet", sourceVenueName: venue.name, sourceAddress: venue.address,
      sourceExcerpt: "이 지점은 실내 좌석의 소음이 적다고 안내합니다." }] }] };
  });
  const result = await enrichDateVenues([venue], { ...emptyDateBrief(), activities: ["meal"],
    preferences: { vibe: ["조용한"], crowdTolerance: 0.2 } });
  expect(search.mock.calls[0][0].payload.venues[0].researchFocus).toContain("menu, noise, crowd");
  expect(result[0].evidence?.[0]).toMatchObject({ venueId: "kakao:quiet-focus", verification: "search_report" });
  expect(result[0].dishes).toBeUndefined();
});

it("does not treat warm menu-only facts as evidence of a quiet conversation venue", async () => {
  const candidates: DiscoverCandidate[] = Array.from({ length: 2 }, (_, index) => ({
    externalSource: "kakao", externalPlaceId: `menu-only-${index}`, name: `메뉴식당${index}`, category: "restaurant",
    categoryLabel: "식당", district: "성동구", address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
    phone: "", mapUrl: "", coordinates: [127.04, 37.56], evidence: [{ id: `menu-${index}`,
      venueId: `kakao:menu-only-${index}`, text: "직접 반죽한 면을 사용합니다.", url: "https://example.com/menu",
      checkedAt: new Date().toISOString(), attribute: "menu", verification: "source_checked" }],
  }));
  search.mockResolvedValue({ venues: [] });
  const result = await enrichDateVenues(candidates, { ...emptyDateBrief(), activities: ["meal"],
    preferences: { vibe: ["조용한"], crowdTolerance: 0.2 } });
  expect(search).toHaveBeenCalledTimes(2);
  expect(search.mock.calls.every(([input]) => input.payload.venues.length === 1
    && input.payload.venues[0].researchFocus.includes("noise, crowd"))).toBe(true);
  expect(result.every(candidate => candidate.evidence?.length === 1)).toBe(true);
  expect(result.some(candidate => candidate.evidence?.some(fact => /조용|소음/.test(fact.text)))).toBe(false);
});

it("does not restore stale input observations when a bounded research wave finds no replacement", async () => {
  const candidates: DiscoverCandidate[] = [{ externalSource: "kakao", externalPlaceId: "expired-input", name: "예전카페",
    category: "cafe", categoryLabel: "카페", district: "성동구", address: "서울 성동구 왕십리로 281",
    roadAddress: "서울 성동구 왕십리로 281", phone: "", mapUrl: "", coordinates: [127.04, 37.56],
    evidence: [{ id: "expired", venueId: "kakao:expired-input", text: "통창과 정원 좌석이 있습니다.",
      url: "https://example.com/old", checkedAt: "2020-01-01T00:00:00.000Z", verification: "source_checked" }] }];
  search.mockResolvedValue({ venues: [] });
  const result = await enrichDateVenues(candidates, { ...emptyDateBrief(), activities: ["cafe"], userRequests: ["예쁜 카페"] });
  expect(result[0].evidence).toEqual([]);
  expect(search).toHaveBeenCalledTimes(1);
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
