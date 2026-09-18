"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SEARCH_COMMANDS } from "@/components/layout/navigation";
import { searchWorkspace, type WorkspaceHit } from "@/features/search/actions";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<WorkspaceHit[]>([]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchWorkspace(query).then(next => {
        if (!cancelled) setHits(next);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_COMMANDS;
    return SEARCH_COMMANDS.filter(item => item.label.toLowerCase().includes(q));
  }, [query]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <dialog ref={ref} onClose={onClose} className="command-dialog">
      <div className="command-search">
        <span>⌕</span>
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="장소, 추억, 일정을 찾아 보세요"
        />
        <kbd>ESC</kbd>
      </div>
      {commands.length > 0 && (
      <div className="command-section">
        <span>빠른 실행</span>
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
    </dialog>
  );
}
