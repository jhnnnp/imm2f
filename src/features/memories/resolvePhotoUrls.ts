import { useEffect, useMemo, useRef, useState } from "react";
import { signMemoryPhotoUrls } from "./actions";
import { signPhotoBatches } from "./signPhotoBatches";
import type { Memory } from "./types";
import { isDisplayableUrl } from "./wallPieces";

export function memoryPhotoIdsNeedingSign(memories: Memory[]) {
  const ids: string[] = [];
  for (const memory of memories) {
    for (const photo of memory.photos) {
      // A usable signed URL is temporary too. Keep newly saved photos in the
      // renewal/retry set, otherwise they stop displaying after their first hour.
      if (photo.storagePath) ids.push(photo.id);
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

export function useResolvedMemories(memories: Memory[], retryKey = 0, onFailure?: (failed: boolean) => void) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const failureCallback = useRef(onFailure);
  failureCallback.current = onFailure;
  const pendingKey = useMemo(() => memoryPhotoIdsNeedingSign(memories).join(","), [memories]);

  useEffect(() => {
    const ids = pendingKey ? pendingKey.split(",") : [];
    if (!ids.length) {
      setUrls({});
      failureCallback.current?.(false);
      return;
    }
    let cancelled = false;
    let lastSigned = 0;
    const refresh = () => {
      lastSigned = Date.now();
      void signPhotoBatches(ids, signMemoryPhotoUrls, () => !cancelled).then(({ urls: next, failed }) => {
        if (!cancelled) {
          setUrls(current => ({ ...current, ...next }));
          failureCallback.current?.(failed);
        }
      });
    };
    refresh();
    // Signed URLs expire in an hour; long-open albums must renew them too.
    const renewAfter = 50 * 60 * 1000;
    const renew = () => { if (document.visibilityState === "visible" && Date.now() - lastSigned >= renewAfter) refresh(); };
    const timer = window.setInterval(renew, renewAfter);
    document.addEventListener("visibilitychange", renew);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [pendingKey, retryKey]);

  return useMemo(() => applyMemoryPhotoUrls(memories, urls), [memories, urls]);
}
