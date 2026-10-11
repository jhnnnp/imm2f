"use client";

export function SyncNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (!message) return null;
  return <div className="sync-notice" role="status"><span>{message}</span><button className="text-button" type="button" onClick={onRetry}>동기화 다시 시도</button></div>;
}
