"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createNotesBatch } from "../actions";
import type { CoupleNote } from "../types";
import type { VaultScanItemDraft } from "../vaultScan";
import { noteCreationAttempt, type NoteCreationAttempt } from "../noteCreationAttempt";

type PreviewRow = VaultScanItemDraft & { id: string; selected: boolean };

function rowId(index: number) {
  return `scan-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export function VaultScreenshotImport({
  persist,
  disabled,
  beginMutation,
  endMutation,
  onError,
  onSaved,
  onPreviewChange,
}: {
  persist: boolean;
  disabled: boolean;
  beginMutation: () => boolean;
  endMutation: () => void;
  onError: (message: string) => void;
  onSaved: (notes: CoupleNote[]) => void;
  onPreviewChange: (preview: boolean) => void;
}) {
  const inputId = useId();
  const [phase, setPhase] = useState<"idle" | "scanning" | "preview">("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const busyRef = useRef(false);
  const scanController = useRef<AbortController | null>(null);
  const creationAttempts = useRef(new Map<string, NoteCreationAttempt>());

  useEffect(() => {
    onPreviewChange(phase === "preview");
  }, [phase, onPreviewChange]);

  useEffect(() => () => {
    scanController.current?.abort();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const runScan = useCallback(async (file: File) => {
    if (!persist) {
      onError("로그인 후 사용할 수 있어요.");
      return;
    }
    if (disabled || busyRef.current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 4 * 1024 * 1024) {
      onError("4MB 이하 JPEG·PNG·WebP 이미지를 선택해 주세요.");
      return;
    }
    if (!beginMutation()) return;
    busyRef.current = true;
    const controller = new AbortController();
    scanController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    onError("");
    setPhase("scanning");
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);

    const body = new FormData();
    body.set("image", file);

    try {
      const response = await fetch("/api/vault/scan", { method: "POST", body, signal: controller.signal });
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
      window.clearTimeout(timeout);
      busyRef.current = false;
      scanController.current = null;
      endMutation();
    }
  }, [beginMutation, disabled, endMutation, onError, persist]);

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
    creationAttempts.current.clear();
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
    if (disabled || busyRef.current || !beginMutation()) return;
    busyRef.current = true;
    onError("");
    const payload = items.map(row => {
      const input = { title: row.title, detail: row.detail, extra: row.extra };
      const attempt = noteCreationAttempt(creationAttempts.current.get(row.id) ?? null, "vault", input);
      creationAttempts.current.set(row.id, attempt);
      return { ...input, attemptId: attempt.id };
    });
    const result = await createNotesBatch("vault", payload)
      .catch(() => ({ error: "저장 응답을 확인하지 못했어요. 보관함을 확인한 뒤 다시 시도해 주세요." }));
    busyRef.current = false;
    endMutation();
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
                  disabled={disabled}
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
                  disabled={disabled}
                />
                <textarea
                  value={row.detail}
                  onChange={event => updateRow(row.id, { detail: event.target.value })}
                  rows={3}
                  aria-label={`${index + 1}번째 메모`}
                  disabled={disabled}
                />
                <input
                  value={row.extra}
                  onChange={event => updateRow(row.id, { extra: event.target.value })}
                  placeholder="예약번호"
                  aria-label={`${index + 1}번째 예약번호`}
                  disabled={disabled}
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
