import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRouteCoords, fetchRoadRoute, isLngLat, parseOsrmRoute } from "./fetchRoadRoute";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("encodes ordered lng,lat pairs", () => {
  expect(encodeRouteCoords([[127.01, 37.02], [127.03, 37.04]])).toBe("127.01,37.02|127.03,37.04");
});

describe("map coordinates and provider responses", () => {
  it("rejects missing, coerced, non-finite and out-of-range coordinates", () => {
    for (const value of [null, [null, null], ["127", "37"], [NaN, 37], [181, 37], [127, 91], [127, 37, 1]]) expect(isLngLat(value)).toBe(false);
    expect(isLngLat([127, 37])).toBe(true);
  });
  it("reads a valid geojson OSRM route", () => {
    expect(parseOsrmRoute({ code: "Ok", routes: [{ geometry: { coordinates: [[127, 37], [127.01, 37.01]] } }] })).toEqual([[127, 37], [127.01, 37.01]]);
  });
  it("rejects provider error codes and malformed path data", () => {
    for (const payload of [null, { code: "NoRoute" }, { routes: "bad" }, { routes: [null] }, { code: "NoRoute", routes: [{ geometry: { coordinates: [[127, 37], [128, 38]] } }] }, { routes: [{ geometry: { coordinates: [[127, 37], [Infinity, 38]] } }] }]) expect(parseOsrmRoute(payload)).toBeNull();
  });
});

describe("fetchRoadRoute", () => {
  it("uses a bounded cache and keeps walking/car routes separate", async () => {
    const path = [[127, 37], [127.01, 37.01]];
    const fetch = vi.fn(async () => Response.json({ coordinates: path }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchRoadRoute([[127, 37], [127.01, 37.01]])).toEqual(path);
    expect(await fetchRoadRoute([[127, 37], [127.01, 37.01]])).toEqual(path);
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchRoadRoute([[127, 37], [127.01, 37.01]], "foot");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("falls back after network, HTTP or invalid JSON failures", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response("invalid json"));
    vi.stubGlobal("fetch", fetch);
    const coords: Array<[number, number]> = [[129, 35], [129.01, 35.01]];
    expect(await fetchRoadRoute(coords)).toBeNull();
    expect(await fetchRoadRoute(coords)).toBeNull();
    expect(await fetchRoadRoute(coords)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("never requests invalid or already-cancelled routes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await fetchRoadRoute([[181, 37], [127, 37]])).toBeNull();
    expect(await fetchRoadRoute([[127, 37], [128, 38]], "driving", AbortSignal.abort())).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts stalled requests and returns the fallback within eight seconds", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const result = fetchRoadRoute([[140, 40], [140.01, 40.01]]);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toBeNull();
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
