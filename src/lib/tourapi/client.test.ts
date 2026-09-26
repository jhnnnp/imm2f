import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTourPlaceOverview } from "./client";

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
