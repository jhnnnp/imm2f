"use client";

import { useState } from "react";
import { createCoupleInvite } from "../session";

export function InviteManager() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function createLink() {
    setPending(true);
    setError("");
    setCopied(false);
    const result = await createCoupleInvite();
    setPending(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    if ("token" in result) {
      const nextLink = `${window.location.origin}/invite/${result.token}`;
      setLink(nextLink);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <div className="invite-manager">
      <button className="primary-button" type="button" onClick={() => void createLink()} disabled={pending}>
        {pending ? "만드는 중..." : link ? "새 초대 링크 만들기" : "초대 링크 만들기"}
      </button>
      {link && (
        <div className="invite-link-row">
          <input readOnly value={link} aria-label="초대 링크" />
          <button className="outline-button" type="button" onClick={() => void copyLink()}>{copied ? "복사됨" : "복사"}</button>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="form-hint">이메일은 아직 보내지 않아요. 링크를 직접 전해 주세요. 14일 동안 유효하고, 새 링크를 만들면 이전 링크는 닫혀요.</p>
    </div>
  );
}
