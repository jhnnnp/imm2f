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

  async function shareLink() {
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "ONLY US 초대", text: "우리의 공간에 초대할게요.", url: link });
        return;
      } catch {
        // Share sheet dismissed or unavailable; copy instead.
      }
    }
    await copyLink();
  }

  return (
    <section className="invite-studio">
      <article className="invite-create-card">
        <header>
          <span className="invite-symbol" aria-hidden="true"><i>나</i><i>?</i></span>
          <div><span className="eyebrow">PRIVATE INVITATION</span><h2>{link ? "초대 링크가 준비됐어요" : "우리의 공간을 연결해요"}</h2><p>{link ? "아래 링크를 파트너에게 전해 주세요." : "한 사람만 링크를 만들면 충분해요. 파트너가 수락하는 순간 같은 공간이 열립니다."}</p></div>
        </header>
        {link ? (
          <div className="invite-result" aria-live="polite">
            <label><span>초대 링크</span><div><input readOnly value={link} aria-label="초대 링크" /><button type="button" onClick={() => void copyLink()}>{copied ? "복사 완료" : "링크 복사"}</button></div></label>
            <div className="invite-result-actions">
              <button className="primary-button" type="button" onClick={() => void shareLink()}>파트너에게 공유</button>
              <button className="text-button" type="button" onClick={() => void createLink()} disabled={pending}>{pending ? "만드는 중…" : "새 링크 만들기"}</button>
            </div>
          </div>
        ) : (
          <div className="invite-create-action">
            <div className="invite-connection-preview" aria-hidden="true"><span>나</span><i><b /></i><span>파트너</span></div>
            <button className="primary-button" type="button" onClick={() => void createLink()} disabled={pending}>{pending ? "안전한 링크를 만드는 중…" : "초대 링크 만들기"}<span>→</span></button>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><span>⌁</span><p><b>14일 동안 유효해요.</b> 새 링크를 만들면 이전 링크는 자동으로 닫힙니다.</p></footer>
      </article>
      <aside className="invite-guide">
        <span className="eyebrow">HOW IT WORKS</span>
        <h3>초대부터 연결까지</h3>
        <ol><li><b>1</b><div><strong>링크 만들기</strong><p>안전한 일회용 초대 링크를 만들어요.</p></div></li><li><b>2</b><div><strong>파트너에게 전달</strong><p>메신저로 링크를 직접 공유해 주세요.</p></div></li><li><b>3</b><div><strong>우리의 공간 시작</strong><p>수락하면 장소, 일정과 추억을 함께 봐요.</p></div></li></ol>
        <p className="invite-privacy"><span>✓</span>링크를 받은 한 사람만 연결할 수 있어요.</p>
      </aside>
    </section>
  );
}
