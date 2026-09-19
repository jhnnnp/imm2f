"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SEARCH_COMMANDS } from "@/components/layout/navigation";
import { searchWorkspace, type WorkspaceHit } from "@/features/search/actions";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hits, setHits] = useState<WorkspaceHit[]>([]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !query.trim()) { setHits([]); setSearching(false); setSearchError(""); return; }
    setSearching(true); setSearchError("");
    setHits([]);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchWorkspace(query).then(next => {
        if (!cancelled) setHits(next);
      }).catch(() => { if (!cancelled) setSearchError("검색을 불러오지 못했어요. 다시 입력해 주세요."); }).finally(() => { if (!cancelled) setSearching(false); });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_COMMANDS.filter(item => q.split(/\s+/).every(word => item.label.toLowerCase().includes(word))).slice(0, 4);
  }, [query]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  if (!open) return null;
  return (
    <div ref={ref} className="command-popover" role="search" aria-label="전체 검색">
      <div className="command-search">
        <span>⌕</span>
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="장소, 추억, 일정을 찾아 보세요"
        />
        {searching ? <i className="button-spinner" aria-label="검색 중" /> : query && <button type="button" className="text-button" onClick={() => setQuery("")} aria-label="검색어 지우기">×</button>}
      </div>
      {!query.trim() && <p className="command-hint">검색어를 입력하면 관련 장소와 기록을 바로 보여드려요.</p>}
      {commands.length > 0 && (
      <div className="command-section">
          <span>바로가기</span>
        {commands.map(item => (
          <a
            href={item.href}
            onMouseEnter={() => router.prefetch(item.href)}
            onFocus={() => router.prefetch(item.href)}
            onClick={event => { event.preventDefault(); go(item.href); }}
            key={item.href}
          >
            <i>{item.icon}</i><b>{item.label}</b>
          </a>
        ))}
      </div>
      )}
      {query.trim() && !searching && !hits.length && !commands.length && <p className="command-hint">{searchError || "찾는 기록이 없어요. 장소 이름이나 다른 단어로 검색해 보세요."}</p>}
      {hits.length > 0 && (
        <div className="command-section">
          <span>검색 결과</span>
          {hits.map(hit => (
            <a
              href={hit.href}
              onMouseEnter={() => router.prefetch(hit.href)}
              onFocus={() => router.prefetch(hit.href)}
              onClick={event => { event.preventDefault(); go(hit.href); }}
              key={`${hit.group}-${hit.href}-${hit.label}`}
            >
              <i>{hit.group}</i>
              <span>
                <b>{hit.label}</b>
                <small>{hit.detail}</small>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
