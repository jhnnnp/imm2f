import type { Memory, MemoryType } from "./types";

export const MAX_MEMORY_PHOTOS = 12;
export const MAX_MEMORY_PHOTO_BYTES = 20 * 1024 * 1024;
export const MEMORY_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

export type WallPhotoSize = "lg" | "md" | "sm";

export type MemoryImage = {
  id: string;
  url: string;
};

export type WallPiece =
  | {
    id: string;
    kind: "photo";
    memoryId: string;
    title: string;
    happenedOn: string;
    locationLabel: string;
    memoryType: MemoryType;
    url: string;
    photoIndex: number;
    photoCount: number;
    size: WallPhotoSize;
  }
  | {
    id: string;
    kind: "note";
    memoryId: string;
    title: string;
    happenedOn: string;
    locationLabel: string;
    description: string;
    memoryType: MemoryType;
  }
  | {
    id: string;
    kind: "scrap";
    quote: string;
  };

export function isDisplayableUrl(url: string | null | undefined) {
  return Boolean(url && /^(https?:\/\/|blob:|data:image\/)/i.test(url));
}

export function memoryImages(memory: Memory): MemoryImage[] {
  const photos = memory.photos
    .filter(photo => isDisplayableUrl(photo.storageUrl))
    .map(photo => ({ id: photo.id, url: photo.storageUrl }));
  if (photos.length) return photos;
  if (isDisplayableUrl(memory.coverUrl)) {
    return [{ id: `${memory.id}-cover`, url: memory.coverUrl ?? "" }];
  }
  return [];
}

export function photoSizeFor(index: number, total: number): WallPhotoSize {
  if (total === 1 || index === 0) return "lg";
  if (index % 5 === 1) return "sm";
  return "md";
}

export function scrapQuoteFrom(memories: Memory[]) {
  const noteTexts = new Set(
    memories
      .filter(memory => memoryImages(memory).length === 0)
      .map(memory => memory.description.trim())
      .filter(Boolean),
  );
  return memories
    .map(memory => memory.description.trim())
    .find(text => text.length > 8 && !noteTexts.has(text) && text.split("·").length < 3) ?? "";
}

export function buildWallPieces(memories: Memory[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  memories.forEach(memory => {
    const images = memoryImages(memory);
    if (images.length) {
      images.forEach((image, photoIndex) => {
        pieces.push({
          id: `photo:${memory.id}:${image.id}`,
          kind: "photo",
          memoryId: memory.id,
          title: memory.title,
          happenedOn: memory.happenedOn,
          locationLabel: memory.locationLabel,
          memoryType: memory.memoryType,
          url: image.url,
          photoIndex,
          photoCount: images.length,
          size: photoSizeFor(photoIndex, images.length),
        });
      });
      return;
    }
    pieces.push({
      id: `note:${memory.id}`,
      kind: "note",
      memoryId: memory.id,
      title: memory.title,
      happenedOn: memory.happenedOn,
      locationLabel: memory.locationLabel,
      description: memory.description,
      memoryType: memory.memoryType,
    });
  });
  const quote = scrapQuoteFrom(memories);
  if (quote) pieces.push({ id: "scrap:quote", kind: "scrap", quote });
  return pieces;
}

export function albumTiles(memories: Memory[]) {
  return memories.flatMap(memory => {
    const images = memoryImages(memory);
    if (!images.length) {
      return [{ memory, image: null as MemoryImage | null, photoIndex: 0 }];
    }
    return images.map((image, photoIndex) => ({ memory, image, photoIndex }));
  });
}
