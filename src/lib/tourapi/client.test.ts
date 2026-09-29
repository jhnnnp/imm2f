import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTourPlaceOverview, searchTourPlacesRemote } from "./client";
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
    expect(url.pathname).toContain("areaBasedList2");
    expect(url.searchParams.get("contentTypeId")).toBe("38");
    expect(url.searchParams.get("areaCode")).toBe("37");
    expect(url.searchParams.get("sigunguCode")).toBe("12");
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
