import { useEffect, useMemo, useRef, useState } from "react";
import { signMemoryPhotoUrls } from "./actions";
import { signPhotoBatches } from "./signPhotoBatches";
import type { Memory } from "./types";
import { isDisplayableUrl } from "./wallPieces";

const RENEW_AFTER_MS = 50 * 60 * 1000;
const EXPIRY_MARGIN_MS = 10 * 60 * 1000;
type RenewedPhotoUrl = { url: string; renewAt: number };

function signedPhotoExpiry(url: string) {
  try {
    const token = new URL(url).searchParams.get("token");
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const exp = claims && typeof claims === "object" && "exp" in claims ? claims.exp : null;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch { return null; }
}

function preferredPhotoUrl(initialUrl: string, renewed?: RenewedPhotoUrl) {
  if (!renewed) return initialUrl;
  // A newer server snapshot can already contain a fresher signature.
  return (signedPhotoExpiry(initialUrl) ?? 0) > (signedPhotoExpiry(renewed.url) ?? 0) ? initialUrl : renewed.url;
}

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
  const [renewedUrls, setRenewedUrls] = useState<Record<string, RenewedPhotoUrl>>({});
  const renewedRef = useRef(renewedUrls);
  renewedRef.current = renewedUrls;
  const failureCallback = useRef(onFailure);
  failureCallback.current = onFailure;
  const previousRetry = useRef(retryKey);
  const photosKey = useMemo(() => JSON.stringify(memories.flatMap(memory => memory.photos
    .filter(photo => photo.storagePath)
    .map(photo => ({ id: photo.id, url: photo.storageUrl })))), [memories]);

  useEffect(() => {
    const photos = [...new Map((JSON.parse(photosKey) as Array<{ id: string; url: string }>).map(photo => [photo.id, photo])).values()];
    const forceRetry = previousRetry.current !== retryKey;
    previousRetry.current = retryKey;
    if (!photos.length) {
      renewedRef.current = {};
      setRenewedUrls({});
      failureCallback.current?.(false);
      return;
    }
    let cancelled = false;
    let running = false;
    let timer = 0;
    const nextRenewal = new Map(photos.map(photo => {
      const cached = renewedRef.current[photo.id];
      const url = preferredPhotoUrl(photo.url, cached);
      // Decode expiry only as a scheduling hint. The server still authorizes
      // every renewal; missing or unreadable signatures are renewed at once.
      const renewAt = cached?.url === url ? cached.renewAt : (signedPhotoExpiry(url) ?? 0) - EXPIRY_MARGIN_MS;
      return [photo.id, Math.min(renewAt, Date.now() + RENEW_AFTER_MS)];
    }));
    const schedule = () => {
      window.clearTimeout(timer);
      const dueAt = Math.min(...nextRenewal.values());
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") void refresh();
      }, Math.max(1, dueAt - Date.now()));
    };
    const refresh = async (force = false) => {
      if (cancelled || running) return;
      const ids = photos.filter(photo => force || (nextRenewal.get(photo.id) ?? 0) <= Date.now()).map(photo => photo.id);
      if (!ids.length) { schedule(); return; }
      running = true;
      // A failed renewal remains retryable without a rapid automatic loop.
      ids.forEach(id => nextRenewal.set(id, Date.now() + RENEW_AFTER_MS));
      const { urls: next, failed } = await signPhotoBatches(ids, signMemoryPhotoUrls, () => !cancelled);
      if (cancelled) return;
      const updates: Record<string, RenewedPhotoUrl> = {};
      Object.entries(next).forEach(([id, url]) => {
        const renewAt = Math.max(Date.now() + 60_000, Math.min(
          (signedPhotoExpiry(url) ?? Date.now() + RENEW_AFTER_MS + EXPIRY_MARGIN_MS) - EXPIRY_MARGIN_MS,
          Date.now() + RENEW_AFTER_MS,
        ));
        updates[id] = { url, renewAt };
        nextRenewal.set(id, renewAt);
      });
      renewedRef.current = { ...renewedRef.current, ...updates };
      setRenewedUrls(renewedRef.current);
      failureCallback.current?.(failed);
      running = false;
      schedule();
    };
    failureCallback.current?.(false);
    void refresh(forceRetry);
    const renew = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", renew);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [photosKey, retryKey]);

  return useMemo(() => {
    const urls: Record<string, string> = {};
    memories.forEach(memory => memory.photos.forEach(photo => {
      if (renewedUrls[photo.id]) urls[photo.id] = preferredPhotoUrl(photo.storageUrl, renewedUrls[photo.id]);
    }));
    return applyMemoryPhotoUrls(memories, urls);
  }, [memories, renewedUrls]);
}
