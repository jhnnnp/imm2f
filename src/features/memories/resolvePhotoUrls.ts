import { useEffect, useMemo, useState } from "react";
import { signMemoryPhotoUrls } from "./actions";
import type { Memory } from "./types";
import { isDisplayableUrl } from "./wallPieces";

export function memoryPhotoIdsNeedingSign(memories: Memory[]) {
  const ids: string[] = [];
  for (const memory of memories) {
    for (const photo of memory.photos) {
      if (photo.storagePath && !isDisplayableUrl(photo.storageUrl)) ids.push(photo.id);
    }
  }
  return ids;
}

export function applyMemoryPhotoUrls(memories: Memory[], urls: Record<string, string>): Memory[] {
  if (!Object.keys(urls).length) return memories;
  return memories.map(memory => {
    let coverUrl = memory.coverUrl;
    const photos = memory.photos.map(photo => {
      const signed = urls[photo.id];
      if (!signed) return photo;
      return { ...photo, storageUrl: signed };
    });
    const first = photos.find(photo => isDisplayableUrl(photo.storageUrl));
    if (first) coverUrl = first.storageUrl;
    else if (coverUrl && !isDisplayableUrl(coverUrl)) coverUrl = null;
    return { ...memory, photos, coverUrl };
  });
}

export function useResolvedMemories(memories: Memory[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pendingKey = useMemo(() => memoryPhotoIdsNeedingSign(memories).join(","), [memories]);

  useEffect(() => {
    const ids = pendingKey ? pendingKey.split(",") : [];
    if (!ids.length) {
      setUrls({});
      return;
    }
    let cancelled = false;
    void signMemoryPhotoUrls(ids).then(next => {
      if (!cancelled) setUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingKey]);

  return useMemo(() => applyMemoryPhotoUrls(memories, urls), [memories, urls]);
}
