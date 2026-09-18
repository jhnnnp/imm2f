import { describe, expect, it } from "vitest";
import type { Memory } from "./types";
import { albumTiles, buildWallPieces, memoryImages, photoSizeFor } from "./wallPieces";

function memory(partial: Partial<Memory> & Pick<Memory, "id" | "title">): Memory {
  return {
    memoryType: "free",
    placeId: null,
    happenedOn: "2026-09-03",
    description: "",
    locationLabel: "",
    coordinates: null,
    createdBy: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    coverUrl: null,
    photos: [],
    ...partial,
  };
}

describe("wall pieces", () => {
  it("turns every displayable photo into its own wall piece", () => {
    const item = memory({
      id: "m1",
      title: "우리의 하루",
      description: "오래 걷던 골목의 불빛.",
      coverUrl: "https://cdn.example/cover.jpg",
      photos: [
        { id: "p1", storageUrl: "https://cdn.example/a.jpg", caption: "", sortOrder: 0, latitude: null, longitude: null, capturedAt: null, originalFilename: "a.jpg", mimeType: "image/jpeg", fileSize: 1, width: 800, height: 600, cameraMake: "", cameraModel: "", locationSource: "none" },
        { id: "p2", storageUrl: "https://cdn.example/b.jpg", caption: "", sortOrder: 1, latitude: null, longitude: null, capturedAt: null, originalFilename: "b.jpg", mimeType: "image/jpeg", fileSize: 1, width: 800, height: 600, cameraMake: "", cameraModel: "", locationSource: "none" },
      ],
    });
    const pieces = buildWallPieces([item]);
    expect(memoryImages(item)).toHaveLength(2);
    expect(pieces.filter(piece => piece.kind === "photo")).toHaveLength(2);
    expect(pieces.some(piece => piece.kind === "scrap")).toBe(true);
    expect(albumTiles([item])).toHaveLength(2);
  });

  it("falls back to cover url and keeps notes as paper", () => {
    const photo = memory({ id: "m2", title: "사진", coverUrl: "https://cdn.example/only.jpg" });
    const note = memory({ id: "m3", title: "편지", description: "사진 없이 남긴 하루." });
    const pieces = buildWallPieces([photo, note]);
    expect(pieces.filter(piece => piece.kind === "photo")).toHaveLength(1);
    expect(pieces.filter(piece => piece.kind === "note")).toHaveLength(1);
    expect(photoSizeFor(0, 1)).toBe("lg");
    expect(photoSizeFor(1, 4)).toBe("sm");
  });
});
