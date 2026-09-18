"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createNotesBatch } from "../actions";
import type { CoupleNote } from "../types";
import type { VaultScanItemDraft } from "../vaultScan";

type PreviewRow = VaultScanItemDraft & { id: string; selected: boolean };

function rowId(index: number) {
  return `scan-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export function VaultScreenshotImport({
  persist,
  disabled,
  onBusy,
  onError,
  onSaved,
  onPreviewChange,
}: {
  persist: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onSaved: (notes: CoupleNote[]) => void;
  onPreviewChange: (preview: boolean) => void;
}) {
  const inputId = useId();
  const [phase, setPhase] = useState<"idle" | "scanning" | "preview">("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);

  useEffect(() => {
    onPreviewChange(phase === "preview");
  }, [phase, onPreviewChange]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const runScan = useCallback(async (file: File) => {
    if (!persist) {
      onError("로그인 후 사용할 수 있어요.");
      return;
    }
    onError("");
    onBusy(true);
    setPhase("scanning");
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);

    const body = new FormData();
    body.set("image", file);

    try {
      const response = await fetch("/api/vault/scan", { method: "POST", body });
      const payload = await response.json() as { items?: VaultScanItemDraft[]; error?: string };
      if (!response.ok) {
        onError(payload.error ?? "스크린샷을 읽지 못했어요.");
        setPhase("idle");
        return;
      }
      const items = payload.items ?? [];
      if (!items.length) {
        onError("예약 정보를 찾지 못했어요.");
        setPhase("idle");
        return;
      }
      setRows(items.map((item, index) => ({ ...item, id: rowId(index), selected: true })));
      setPhase("preview");
    } catch {
      onError("스크린샷을 읽는 중 문제가 생겼어요.");
      setPhase("idle");
    } finally {
      onBusy(false);
    }
  }, [onBusy, onError, persist]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (phase === "scanning" || disabled) return;
      const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void runScan(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled, phase, runScan]);

  function resetScan() {
    setPhase("idle");
    setRows([]);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }

  function updateRow(id: string, patch: Partial<VaultScanItemDraft>) {
    setRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function saveSelected() {
    const items = rows.filter(row => row.selected && row.title.trim());
    if (!items.length) {
      onError("저장할 항목을 하나 이상 선택해 주세요.");
      return;
    }
    onBusy(true);
    onError("");
    const result = await createNotesBatch("vault", items.map(({ title, detail, extra }) => ({ title, detail, extra })));
    onBusy(false);
    if ("error" in result) {
      onError(result.error);
      return;
    }
    onSaved(result.notes);
    resetScan();
  }

  if (phase === "preview") {
    const selectedCount = rows.filter(row => row.selected && row.title.trim()).length;
    return (
      <div className="vault-scan-preview" aria-live="polite">
        <div className="vault-scan-preview-head">
          <div>
            <span className="eyebrow">SCAN RESULT</span>
            <b>{rows.length}건으로 나눴어요</b>
            <p>번호·시간이 맞는지 확인한 뒤 저장해 주세요.</p>
          </div>
          {previewUrl ? <img className="vault-scan-thumb" src={previewUrl} alt="" /> : null}
        </div>
        <ul className="vault-scan-list">
          {rows.map((row, index) => (
            <li key={row.id} className={row.selected ? "" : "is-off"}>
              <label className="vault-scan-check">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={event => setRows(current => current.map(item => (item.id === row.id ? { ...item, selected: event.target.checked } : item)))}
                />
                <span>{index + 1}</span>
              </label>
              <div className="vault-scan-fields">
                <input
                  value={row.title}
                  onChange={event => updateRow(row.id, { title: event.target.value })}
                  aria-label={`${index + 1}번째 제목`}
                />
                <textarea
                  value={row.detail}
                  onChange={event => updateRow(row.id, { detail: event.target.value })}
                  rows={3}
                  aria-label={`${index + 1}번째 메모`}
                />
                <input
                  value={row.extra}
                  onChange={event => updateRow(row.id, { extra: event.target.value })}
                  placeholder="예약번호"
                  aria-label={`${index + 1}번째 예약번호`}
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="vault-scan-actions dialog-actions">
          <button className="outline-button" type="button" disabled={disabled} onClick={resetScan}>다시 읽기</button>
          <button className="primary-button" type="button" disabled={disabled || selectedCount === 0} onClick={() => void saveSelected()}>
            {disabled ? "저장 중…" : `${selectedCount}건 보관하기`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`vault-scan-upload${phase === "scanning" ? " is-scanning" : ""}`}>
      <label className="vault-scan-drop" htmlFor={inputId}>
        <span className="eyebrow">SCREENSHOT</span>
        <b>{phase === "scanning" ? "예약 정보를 읽는 중…" : "예약 스크린샷 올리기"}</b>
        <p>한 장에 여러 예약이 있어도 구간별로 나눠 드려요. JPEG·PNG·WebP · 4MB 이하</p>
        <span className="vault-scan-hint">파일 선택 또는 클립보드 붙여넣기</span>
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled || phase === "scanning"}
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void runScan(file);
        }}
      />
      <p className="vault-scan-privacy">스크린샷은 예약 번호를 읽기 위해 OpenAI로 전송돼요. 민감한 정보는 가리고 올려도 됩니다.</p>
    </div>
  );
}
