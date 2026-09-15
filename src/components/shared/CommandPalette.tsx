"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} onClose={onClose} className="command-dialog">
    <div className="command-search"><span>⌕</span><input autoFocus placeholder="무엇을 찾고 있나요?" /><kbd>ESC</kbd></div>
    <div className="command-section"><span>빠른 실행</span>
      <Link href="/trip" onClick={onClose}><i>◇</i><b>새 여행 만들기</b><kbd>↵</kbd></Link>
      <Link href="/date" onClick={onClose}><i>○</i><b>새 데이트 만들기</b></Link>
      <Link href="/places" onClick={onClose}><i>⌖</i><b>장소 추가</b></Link>
      <Link href="/memories" onClick={onClose}><i>▧</i><b>추억 추가</b></Link>
    </div>
  </dialog>;
}
