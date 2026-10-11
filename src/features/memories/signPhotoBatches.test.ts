import { describe, expect, it, vi } from "vitest";
import { signPhotoBatches } from "./signPhotoBatches";

const makeIds = (count: number) => Array.from({ length: count }, (_, i) => `photo-${i}`);
const urlsFor = (ids: string[]) => Object.fromEntries(ids.map(id => [id, `https://photos/${id}`]));

describe("private album photo batches", () => {
  it("does not permanently drop the 49th and later private photos", async () => {
    const sign = vi.fn(async (ids: string[]) => urlsFor(ids));
    const ids = makeIds(145);
    const result = await signPhotoBatches([...ids, ids[0]], sign);
    expect(Object.keys(result.urls)).toHaveLength(145);
    expect(result.urls[ids.at(-1)!]).toBe(`https://photos/${ids.at(-1)}`);
    expect(result.failed).toBe(false);
    expect(sign.mock.calls.map(([batch]) => batch.length)).toEqual([48, 48, 48, 1]);
  });

  it("keeps signing concurrency bounded while loading a large album", async () => {
    let active = 0;
    let maxActive = 0;
    await signPhotoBatches(makeIds(200), async ids => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return urlsFor(ids);
    });
    expect(maxActive).toBe(2);
  });

  it("keeps successful photos visible and reports a failed batch for retry", async () => {
    const sign = vi.fn(async (ids: string[]) => {
      if (ids.includes("photo-48")) throw new Error("offline");
      return urlsFor(ids);
    });
    const result = await signPhotoBatches(makeIds(120), sign);
    expect(result.failed).toBe(true);
    expect(result.urls["photo-0"]).toBeTruthy();
    expect(result.urls["photo-119"]).toBeTruthy();
    expect(result.urls["photo-48"]).toBeUndefined();
  });

  it("stops obsolete album requests before starting another group", async () => {
    let current = true;
    const sign = vi.fn(async (ids: string[]) => {
      current = false;
      return urlsFor(ids);
    });
    const result = await signPhotoBatches(makeIds(200), sign, () => current);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(result.urls).toEqual({});
  });

  it("reports per-photo signing omissions instead of presenting them as complete", async () => {
    expect(await signPhotoBatches(["photo-1"], async () => ({}))).toEqual({ urls: {}, failed: true });
  });
});
