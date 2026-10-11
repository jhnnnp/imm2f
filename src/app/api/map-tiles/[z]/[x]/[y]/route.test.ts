import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const tile = (z: string, x: string, y: string) => GET(new Request("http://localhost/api/map-tiles"), { params: Promise.resolve({ z, x, y }) });

describe("map tile API", () => {
  it("rejects impossible, negative, excessive or non-integer tiles before fetch", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const [z, x, y] of [["15", "0", "0"], ["1", "2", "0"], ["1", "0", "2"], ["-1", "0", "0"], ["1", "0.5", "0"], ["1", "99999999", "0"]]) expect((await tile(z, x, y)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serves valid vector tiles with shared cache headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    const response = await tile("14", "13972", "6348");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.mapbox-vector-tile");
    expect(response.headers.get("cache-control")).toContain("s-maxage=21600");
  });
  it("converts unavailable upstreams into a controlled error response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await tile("0", "0", "0")).status).toBe(502);
  });
});
