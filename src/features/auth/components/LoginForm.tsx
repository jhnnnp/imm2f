"use client";

import { useActionState } from "react";
import { signIn, type AuthActionState } from "../session";

const initialState: AuthActionState = null;

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form className="auth-form" action={formAction}>
      <input type="hidden" name="next" value={nextPath} />
      <label className="field">
        <span>이메일</span>
        <input type="email" name="email" autoComplete="email" required placeholder="you@example.com" />
      </label>
      <label className="field">
        <span>비밀번호</span>
        <input type="password" name="password" autoComplete="current-password" required minLength={8} />
      </label>
      {state?.error && <p className="form-error" role="alert" aria-live="polite">{state.error}</p>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? "들어가는 중..." : "우리 공간으로"}</button>
    </form>
  );
}
