"use client";

import { useState } from "react";
import { signUp } from "../session";

export function SignupForm({ inviteToken }: { inviteToken?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError("");
    const result = await signUp(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <form className="auth-form" action={onSubmit}>
      {inviteToken && <input type="hidden" name="invite" value={inviteToken} />}
      <label className="field">
        <span>이름</span>
        <input name="displayName" autoComplete="name" required placeholder="지은" />
      </label>
      <label className="field">
        <span>이메일</span>
        <input type="email" name="email" autoComplete="email" required placeholder="you@example.com" />
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input type="password" name="password" autoComplete="new-password" required minLength={8} placeholder="8자 이상" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? "만드는 중..." : inviteToken ? "가입하고 연결하기" : "공간 만들기"}</button>
    </form>
  );
}
