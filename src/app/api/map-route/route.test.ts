import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const request = (coords: string, profile = "driving") => new Request(`http://localhost/api/map-route?${new URLSearchParams({ coords, profile })}`);

describe("map route API", () => {
  it("rejects malformed input as a whole without silently dropping stops", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const coords of ["", "127,37", "127,37||128,38", "127,37|,38", "127,37|128,38,1", "127,37|181,38", Array(51).fill("127,37").join("|")]) expect((await GET(request(coords))).status).toBe(400);
    expect((await GET(request("127,37|128,38", "transit"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the pedestrian graph and a compact overview for walking", async () => {
    const path = [[127, 37], [127.01, 37.01]];
    const fetch = vi.fn(async () => Response.json({ code: "Ok", routes: [{ geometry: { coordinates: path } }] }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(request("127,37|127.01,37.01", "foot"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ coordinates: path, profile: "foot" });
    expect(fetch.mock.calls[0]?.[0]).toContain("routing.openstreetmap.de/routed-foot/");
    expect(fetch.mock.calls[0]?.[0]).toContain("overview=simplified");
  });
  it("bounds provider latency and clears the deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted"))))));
    const pending = GET(request("127,37|128,38"));
    await vi.advanceTimersByTimeAsync(6_000);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "routing_timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
