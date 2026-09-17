"use client";

import { useActionState } from "react";
import { signUp, type AuthActionState } from "../session";

const initialState: AuthActionState = null;

export function SignupForm({ inviteToken }: { inviteToken?: string }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  return (
    <form className="auth-form" action={formAction}>
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
      {state?.error && <p className="form-error" role="alert" aria-live="polite">{state.error}</p>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? "만드는 중..." : inviteToken ? "가입하고 연결하기" : "공간 만들기"}</button>
    </form>
  );
}
