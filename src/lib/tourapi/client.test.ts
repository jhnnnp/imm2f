import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTourPlaceDetail, loadTourPlaceOverview, searchTourPlacesRemote } from "./client";
import { koreaTodayYmd } from "./festivalSchedule";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("TourAPI attraction overview", () => {
  it("uses supported detailCommon2 parameters and reads official text", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "test-key");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ response: { header: { resultCode: "0000" },
        body: { items: { item: { overview: "<p>역사적 건축물을 둘러볼 수 있다.</p>" } } } } }) }));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadTourPlaceOverview("123")).toBe("역사적 건축물을 둘러볼 수 있다.");
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toContain("detailCommon2");
    expect(url.searchParams.get("contentId")).toBe("123");
    expect(url.searchParams.has("overviewYN")).toBe(false);
  });

  it("treats root-level API errors as failures", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ resultCode: "10", resultMsg: "INVALID_REQUEST_PARAMETER_ERROR" }) })));
    expect(await loadTourPlaceOverview("123")).toBe("");
  });
});

describe("TourAPI discovery content types", () => {
  it("browses a region's shopping source type and preserves its identity", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "test-key");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ response: { header: { resultCode: "0000" },
        body: { totalCount: 1, items: { item: [{ contentid: "38-1", title: "전주 남부시장",
          addr1: "전북 전주시 완산구", mapx: "127.148", mapy: "35.824" }] } } } }) }));
    vi.stubGlobal("fetch", fetcher);
    const response = await searchTourPlacesRemote({ region: "전주", category: "tourist",
      query: "", tourContentTypeId: "38" });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.places[0]).toMatchObject({ category: "tourist", categoryLabel: "쇼핑",
      tourContentTypeId: "38", name: "전주 남부시장" });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toContain("locationBasedList2");
    expect(url.searchParams.get("contentTypeId")).toBe("38");
    expect(url.searchParams.get("mapX")).toBe("127.148");
    expect(url.searchParams.has("areaCode")).toBe(false);
    expect(url.searchParams.has("sigunguCode")).toBe(false);
  });

  it("drops undated festival listings from the calendar", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ response: { header: { resultCode: "0000" },
        body: { totalCount: 1, items: { item: [{ contentid: "15-1", title: "일정 미확인 축제",
          addr1: "전북 전주시 완산구", mapx: "127.148", mapy: "35.824" }] } } } }) })));
    const response = await searchTourPlacesRemote({ region: "전주", category: "festival", query: "축제" });
    expect(response.ok && response.places).toEqual([]);
  });

  it("keeps city festival requests inside that city after province-level retrieval", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "test-key");
    const today = koreaTodayYmd();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ response: { header: { resultCode: "0000" },
        body: { totalCount: 2, items: { item: [
          { contentid: "15-jeonju", title: "전주 축제", addr1: "전북 전주시 완산구",
            mapx: "127.148", mapy: "35.824", eventstartdate: today, eventenddate: "20991231" },
          { contentid: "15-gunsan", title: "군산 축제", addr1: "전북 군산시 중앙로",
            mapx: "126.7116", mapy: "35.9871", eventstartdate: today, eventenddate: "20991231" },
        ] } } } }) })));
    const response = await searchTourPlacesRemote({ region: "전주", category: "festival", query: "축제" });
    expect(response.ok && response.places.map(place => place.name)).toEqual(["전주 축제"]);
  });
});

describe("current TourAPI request and detail contract", () => {
  const payload = (items: unknown[]) => JSON.stringify({ response: { header: { resultCode: "0000" },
    body: { totalCount: items.length, items: { item: items } } } });
  it("uses legal-dong province codes rather than retired area filters", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "legal-dong-test");
    const fetcher = vi.fn(async () => new Response(payload([])));
    vi.stubGlobal("fetch", fetcher);
    await searchTourPlacesRemote({ region: "서울", category: "tourist", tourContentTypeId: "38" });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toContain("areaBasedList2");
    expect(url.searchParams.get("lDongRegnCd")).toBe("11");
    expect(url.searchParams.has("areaCode")).toBe(false);
    expect(url.searchParams.has("sigunguCode")).toBe(false);
  });
  it("preserves a specific keyword and rejects results of another content type or region", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "keyword-test");
    const row = { title: "현대미술관", addr1: "서울 종로구", mapx: "126.98", mapy: "37.57" };
    const fetcher = vi.fn(async () => new Response(payload([
      { ...row, contentid: "culture", contenttypeid: "14" },
      { ...row, contentid: "shop", contenttypeid: "38" },
      { ...row, contentid: "no-type" },
      { ...row, contentid: "busan", contenttypeid: "14", addr1: "부산 해운대구", mapx: "129.16", mapy: "35.16" },
    ])));
    vi.stubGlobal("fetch", fetcher);
    const result = await searchTourPlacesRemote({ region: "서울", query: "현대미술", tourContentTypeId: "14" });
    expect(result.ok && result.places.map(row => row.externalPlaceId)).toEqual(["culture"]);
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toContain("searchKeyword2");
    expect(url.searchParams.get("keyword")).toBe("현대미술");
    expect(url.searchParams.has("contentTypeId")).toBe(false);
    expect(url.searchParams.get("lDongRegnCd")).toBe("11");
  });
  it("maps culture hours and closing days while skipping optional images for planning", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "detail-test");
    const fetcher = vi.fn(async (url: URL) => new Response(payload(url.pathname.includes("detailIntro2")
      ? [{ usetimeculture: "10:00~18:00", restdateculture: "매주 월요일", parkingculture: "가능" }]
      : [{ overview: "현대미술 전시 공간" }])));
    vi.stubGlobal("fetch", fetcher);
    const signal = AbortSignal.timeout(1000);
    const detail = await loadTourPlaceDetail("culture", "photo", "14", { includeImages: false, signal });
    expect(detail).toMatchObject({ overview: "현대미술 전시 공간", openingHours: "10:00~18:00",
      facts: [{ label: "휴무", value: "매주 월요일" }, { label: "주차", value: "가능" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => !url.pathname.includes("detailImage2"))).toBe(true);
  });
  it("does not advertise canceled festivals and reports gateway rate limits correctly", async () => {
    vi.stubEnv("TOUR_API_SERVICE_KEY", "festival-status-test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(payload([{ contentid: "cancelled", title: "취소된 축제",
      addr1: "서울 종로구", mapx: "126.98", mapy: "37.57", progresstype: "행사취소",
      eventstartdate: koreaTodayYmd(), eventenddate: "20991231" }]))));
    const result = await searchTourPlacesRemote({ region: "서울", category: "festival" });
    expect(result.ok && result.places).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<OpenAPI_ServiceResponse><returnReasonCode>22</returnReasonCode></OpenAPI_ServiceResponse>")));
    const limited = await searchTourPlacesRemote({ region: "서울", category: "tourist" });
    expect(limited).toMatchObject({ ok: false, code: "rate_limited" });
  });
});
