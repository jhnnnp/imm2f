"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { loginHrefForInvite, signupHrefForInvite } from "../invitePath";
import { acceptCoupleInvite } from "../session";

export function InviteAccept({ token, inviterName, signedIn }: { token: string; inviterName: string; signedIn: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const accepting = useRef(false);

  async function accept() {
    if (accepting.current) return;
    accepting.current = true;
    setPending(true);
    setError("");
    try {
      const result = await acceptCoupleInvite(token);
      if (result?.error) setError(result.error);
    } catch { setError("초대를 수락하지 못했어요. 다시 시도해 주세요."); }
    finally { accepting.current = false; setPending(false); }
  }

  return (
    <div className="auth-form">
      <p className="auth-lead"><b>{inviterName}</b>님이 우리의 공간으로 초대했어요.</p>
      {signedIn && <p className="form-hint">내 공간에 저장된 기록이 있으면 연결을 진행할 수 없어요. 기존 기록을 안전하게 보존하기 위한 안내예요.</p>}
      {signedIn ? (
        <button className="primary-button full" type="button" onClick={() => void accept()} disabled={pending}>
          {pending ? "연결 중..." : "초대 수락하기"}
        </button>
      ) : (
        <Link className="primary-button full auth-button-link" href={signupHrefForInvite(token)}>가입하고 연결하기</Link>
      )}
      {!signedIn && <p className="form-hint">이미 계정이 있으면 <Link href={loginHrefForInvite(token)}>로그인</Link>하면 바로 연결돼요.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
