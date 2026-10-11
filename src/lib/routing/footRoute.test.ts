import { afterEach, expect, it, vi } from "vitest";
import { parseFootRoute } from "./footRoute";

const coordinates: Array<[number, number]> = [[127.04, 37.56], [127.045, 37.56], [127.05, 37.56]];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses provider legs to report the actual route rather than direct distance", () => {
  const route = parseFootRoute({ code: "Ok", routes: [{ legs: [
    { distance: 620, duration: 510 }, { distance: 580, duration: 480 },
  ] }] }, coordinates);
  expect(route).toMatchObject({ meters: 1200, seconds: 990, provider: "osm_foot" });
  expect(route?.legs.map(leg => leg.meters)).toEqual([620, 580]);
});

it("rejects missing or implausible route legs", () => {
  expect(parseFootRoute({ code: "Ok", routes: [{ legs: [{ distance: 100, duration: 30 }] }] }, coordinates)).toBeNull();
  expect(parseFootRoute({ code: "Ok", routes: [{ legs: [
    { distance: 100, duration: 30 }, { distance: 580, duration: 480 },
  ] }] }, coordinates)).toBeNull();
});

it("shares one provider request while a canceled caller leaves the other caller running", async () => {
  vi.resetModules();
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchFootRoute } = await import("./footRoute");
  const controller = new AbortController();
  const canceled = fetchFootRoute(coordinates, controller.signal);
  const surviving = fetchFootRoute(coordinates);
  controller.abort();
  expect(await canceled).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish(Response.json({ code: "Ok", routes: [{ legs: [
    { distance: 620, duration: 510 }, { distance: 580, duration: 480 },
  ] }] }));
  expect(await surviving).toMatchObject({ meters: 1200 });
  expect(await fetchFootRoute(coordinates)).toMatchObject({ seconds: 990 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("bounds a stalled response body and releases the in-flight entry for a retry", async () => {
  vi.resetModules();
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) });
  vi.stubGlobal("fetch", fetchMock);
  const { fetchFootRoute } = await import("./footRoute");
  const stalled = fetchFootRoute(coordinates);
  await Promise.resolve();
  controller.abort();
  expect(await stalled).toBeNull();
  const fresh = new AbortController();
  vi.mocked(AbortSignal.timeout).mockReturnValue(fresh.signal);
  fetchMock.mockResolvedValueOnce(Response.json({ code: "Ok", routes: [{ legs: [
    { distance: 620, duration: 510 }, { distance: 580, duration: 480 },
  ] }] }));
  expect(await fetchFootRoute(coordinates)).toMatchObject({ meters: 1200 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("rejects invalid coordinates and a pre-aborted request before contacting the provider", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { fetchFootRoute } = await import("./footRoute");
  expect(await fetchFootRoute([[200, 37], [127, 37]])).toBeNull();
  expect(await fetchFootRoute(coordinates, AbortSignal.abort())).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
