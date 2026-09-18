"use client";

import { useState } from "react";
import Link from "next/link";
import { loginHrefForInvite, signupHrefForInvite } from "../invitePath";
import { acceptCoupleInvite } from "../session";

export function InviteAccept({ token, inviterName, signedIn }: { token: string; inviterName: string; signedIn: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    setError("");
    const result = await acceptCoupleInvite(token);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <div className="auth-form">
      <p className="auth-lead"><b>{inviterName}</b>님이 우리의 공간으로 초대했어요.</p>
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
