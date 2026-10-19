// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ signMemoryPhotoUrls: vi.fn() }));
import { signMemoryPhotoUrls } from "./actions";
import { applyMemoryPhotoUrls, memoryPhotoIdsNeedingSign, useResolvedMemories } from "./resolvePhotoUrls";
import type { Memory, MemoryPhoto } from "./types";

const photo = (id: string, storageUrl: string, storagePath: string | null): MemoryPhoto => ({
  id, storageUrl, storagePath, caption: "", sortOrder: 0, latitude: null, longitude: null,
  capturedAt: null, originalFilename: "", mimeType: "", fileSize: null, width: null,
  height: null, cameraMake: "", cameraModel: "", locationSource: "none",
});
const memory = (photos: MemoryPhoto[]): Memory => ({
  id: "memory", title: "추억", memoryType: "free", placeId: null, description: "",
  locationLabel: "", happenedOn: "2026-10-11", coordinates: null, createdAt: "now",
  createdBy: "me", coverUrl: photos[0]?.storageUrl ?? null, photos,
});

describe("private photo renewal", () => {
  it("includes freshly saved signed photos in renewals and manual retries", () => {
    const saved = memory([photo("private", "https://storage/object/sign/photo?token=old", "couple/photo.jpg")]);
    expect(memoryPhotoIdsNeedingSign([saved])).toEqual(["private"]);
  });

  it("does not try to sign an external cover image", () => {
    const external = memory([photo("external", "https://images/cover.jpg", null)]);
    expect(memoryPhotoIdsNeedingSign([external])).toEqual([]);
  });

  it("replaces both an expired photo URL and its cover with the renewed URL", () => {
    const expired = memory([photo("private", "https://storage/old", "couple/photo.jpg")]);
    const result = applyMemoryPhotoUrls([expired], { private: "https://storage/renewed" });
    expect(result[0].coverUrl).toBe("https://storage/renewed");
    expect(result[0].photos[0].storageUrl).toBe("https://storage/renewed");
    expect(expired.photos[0].storageUrl).toBe("https://storage/old");
  });

  it("keeps working photos visible when another photo renewal failed", () => {
    const saved = memory([photo("a", "https://storage/a", "couple/a.jpg"), photo("b", "https://storage/b", "couple/b.jpg")]);
    const result = applyMemoryPhotoUrls([saved], { a: "https://storage/renewed-a" });
    expect(result[0].photos.map(item => item.storageUrl)).toEqual(["https://storage/renewed-a", "https://storage/b"]);
  });
});

const MINUTE = 60_000;
function signedUrl(id: string, validForMinutes = 60) {
  const payload = btoa(JSON.stringify({ exp: (Date.now() + validForMinutes * MINUTE) / 1000 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://storage.example/object/sign/memory-photos/${id}?token=header.${payload}.signature`;
}
const sign = vi.mocked(signMemoryPhotoUrls);

describe("useResolvedMemories request scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));
    sign.mockReset();
    sign.mockImplementation(async ids => Object.fromEntries(ids.map(id => [id, signedUrl(id)])));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders a valid server signature without another mount request and renews after 50 minutes", async () => {
    const url = signedUrl("private");
    const saved = [memory([photo("private", url, "couple/photo.jpg")])];
    const { result } = renderHook(() => useResolvedMemories(saved));
    expect(result.current[0].photos[0].storageUrl).toBe(url);
    expect(sign).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(50 * MINUTE - 1));
    expect(sign).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(sign).toHaveBeenCalledExactlyOnceWith(["private"]);
    expect(result.current[0].photos[0].storageUrl).not.toBe(url);
  });

  it("uses the signature expiry rather than restarting its lifetime on each page mount", async () => {
    const saved = [memory([photo("private", signedUrl("private", 30), "couple/photo.jpg")])];
    renderHook(() => useResolvedMemories(saved));
    expect(sign).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(20 * MINUTE));
    expect(sign).toHaveBeenCalledExactlyOnceWith(["private"]);
  });

  it("immediately signs only missing, expired, and unreadable private URLs", async () => {
    const saved = [memory([
      photo("fresh", signedUrl("fresh"), "couple/fresh.jpg"),
      photo("missing", "", "couple/missing.jpg"),
      photo("expired", signedUrl("expired", -1), "couple/expired.jpg"),
      photo("unreadable", "https://storage.example/object/sign/photo?token=old", "couple/old.jpg"),
      photo("external", "https://images.example/cover.jpg", null),
    ])];
    const { result } = renderHook(() => useResolvedMemories(saved));
    await act(async () => {});
    expect(sign).toHaveBeenCalledExactlyOnceWith(["missing", "expired", "unreadable"]);
    expect(result.current[0].photos[1].storageUrl).toBe(signedUrl("missing"));
  });

  it("keeps manual retry available even when the current signature has not expired", async () => {
    const saved = [memory([photo("private", signedUrl("private"), "couple/photo.jpg")])];
    const { rerender } = renderHook(({ retry }) => useResolvedMemories(saved, retry), { initialProps: { retry: 0 } });
    expect(sign).not.toHaveBeenCalled();
    rerender({ retry: 1 });
    await act(async () => {});
    expect(sign).toHaveBeenCalledExactlyOnceWith(["private"]);
  });

  it("waits while a tab is hidden and renews overdue photos when it becomes visible", async () => {
    const saved = [memory([photo("private", signedUrl("private"), "couple/photo.jpg")])];
    renderHook(() => useResolvedMemories(saved));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => vi.advanceTimersByTimeAsync(61 * MINUTE));
    expect(sign).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(sign).toHaveBeenCalledExactlyOnceWith(["private"]);
  });

  it("preserves a working photo after renewal fails and retries when requested", async () => {
    const url = signedUrl("private");
    const saved = [memory([photo("private", url, "couple/photo.jpg")])];
    const onFailure = vi.fn();
    sign.mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(({ retry }) => useResolvedMemories(saved, retry, onFailure), { initialProps: { retry: 0 } });
    await act(() => vi.advanceTimersByTimeAsync(50 * MINUTE));
    expect(onFailure).toHaveBeenLastCalledWith(true);
    expect(result.current[0].photos[0].storageUrl).toBe(url);
    rerender({ retry: 1 });
    await act(async () => {});
    expect(sign).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenLastCalledWith(false);
    expect(result.current[0].photos[0].storageUrl).not.toBe(url);
  });

  it("uses a newer server signature instead of overwriting it with an older renewal", async () => {
    const initial = [memory([photo("private", "", "couple/photo.jpg")])];
    const { result, rerender } = renderHook(({ saved }) => useResolvedMemories(saved), { initialProps: { saved: initial } });
    await act(async () => {});
    expect(sign).toHaveBeenCalledTimes(1);
    const newerUrl = signedUrl("private", 90);
    rerender({ saved: [memory([photo("private", newerUrl, "couple/photo.jpg")])] });
    expect(result.current[0].photos[0].storageUrl).toBe(newerUrl);
    expect(sign).toHaveBeenCalledTimes(1);
  });
});
