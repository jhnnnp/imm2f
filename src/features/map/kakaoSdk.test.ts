import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retries a failed SDK configuration instead of caching rejection permanently", async () => {
  vi.stubGlobal("window", {});
  const fetch = vi.fn(async () => Response.json({ key: "" }));
  vi.stubGlobal("fetch", fetch);
  const { loadKakaoMaps } = await import("./kakaoSdk");
  await expect(loadKakaoMaps()).rejects.toThrow("not configured");
  const maps = { load: vi.fn((callback: () => void) => callback()) };
  vi.stubGlobal("window", { kakao: { maps } });
  await expect(loadKakaoMaps()).resolves.toBe(maps);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("shares initialization across simultaneous location previews", async () => {
  const maps = { load: vi.fn((callback: () => void) => callback()) };
  vi.stubGlobal("window", { kakao: { maps } });
  const { loadKakaoMaps } = await import("./kakaoSdk");
  const first = loadKakaoMaps();
  expect(loadKakaoMaps()).toBe(first);
  await expect(first).resolves.toBe(maps);
  expect(maps.load).toHaveBeenCalledTimes(1);
});

it("times out a SDK that never calls its ready callback", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { kakao: { maps: { load: vi.fn() } } });
  const { loadKakaoMaps } = await import("./kakaoSdk");
  const pending = expect(loadKakaoMaps()).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(8_000);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});
