import { describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ signMemoryPhotoUrls: vi.fn() }));
import { applyMemoryPhotoUrls, memoryPhotoIdsNeedingSign } from "./resolvePhotoUrls";
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
