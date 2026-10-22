"use client";

import { useRef, useState } from "react";
import { createCoupleInvite } from "../session";
import styles from "./PartnerSpace.module.css";

export function InviteManager() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const creating = useRef(false);
  const sharing = useRef(false);
  const [sharingNow, setSharingNow] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  async function createLink() {
    if (creating.current || sharing.current) return;
    creating.current = true;
    setPending(true);
    setError("");
    setCopied(false);
    try {
      const result = await createCoupleInvite();
      if ("error" in result && result.error) { setError(result.error); return; }
      if ("token" in result) { setLink(`${window.location.origin}/invite/${result.token}`); setExpiresAt(result.expiresAt ?? null); }
    } catch { setError("초대 링크를 만들지 못했어요. 다시 시도해 주세요."); }
    finally { creating.current = false; setPending(false); }
  }

  async function copyLink() {
    if (!link || creating.current) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setError("");
    } catch { setError("자동 복사가 되지 않았어요. 위 링크를 선택해서 복사해 주세요."); }
  }

  async function shareLink() {
    if (!link || creating.current || sharing.current) return;
    sharing.current = true; setSharingNow(true); setError("");
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: "ONLY US 초대", text: "우리의 공간에 초대할게요.", url: link });
          return;
        } catch (cause) {
          if (cause && typeof cause === "object" && "name" in cause && cause.name === "AbortError") return;
        }
      }
      await copyLink();
    } finally { sharing.current = false; setSharingNow(false); }
  }

  return (
    <section className={`invite-studio ${styles.space}`} aria-busy={pending || sharingNow}>
      <article className="invite-create-card">
        <header>
          <span className="invite-symbol" aria-hidden="true"><i>나</i><i>?</i></span>
          <div><span className="eyebrow">PRIVATE INVITATION</span><h2>{link ? "초대 링크가 준비됐어요" : "우리의 공간을 연결해요"}</h2><p>{link ? "아래 링크를 파트너에게 전해 주세요." : "한 사람만 링크를 만들면 충분해요. 파트너가 수락하는 순간 같은 공간이 열립니다."}</p></div>
        </header>
        {link ? (
          <div className="invite-result" aria-live="polite">
            <label><span>초대 링크</span><div><input readOnly value={link} aria-label="초대 링크" /><button type="button" disabled={pending || sharingNow} onClick={() => void copyLink()}>{copied ? "복사 완료" : "링크 복사"}</button></div></label>
            {expiresAt && <small className={styles.expiry}>{new Date(expiresAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" })}까지 사용할 수 있어요.</small>}
            {copied && <p className={styles.feedback} role="status">링크를 복사했어요. 파트너에게 전달해 주세요.</p>}
            <div className="invite-result-actions">
              <button className="primary-button" type="button" disabled={pending || sharingNow} onClick={() => void shareLink()}>{sharingNow ? "공유 창 여는 중…" : "파트너에게 공유"}</button>
              <button className="text-button" type="button" onClick={() => void createLink()} disabled={pending || sharingNow}>{pending ? "만드는 중…" : "새 링크 만들기"}</button>
            </div>
          </div>
        ) : (
          <div className="invite-create-action">
            <div className="invite-connection-preview" aria-hidden="true"><span>나</span><i><b /></i><span>파트너</span></div>
            <button className="primary-button" type="button" onClick={() => void createLink()} disabled={pending || sharingNow}>{pending ? "안전한 링크를 만드는 중…" : "초대 링크 만들기"}<span aria-hidden="true">→</span></button>
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
